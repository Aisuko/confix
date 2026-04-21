import numpy as np
import pandas as pd
import torch
from inteprelens.core.chg import CHG
from tqdm.auto import tqdm

from .config import CHOICES, CLASSES, CONFIDENCE_THRESHOLD, NUM_BINS
from .heads import keep_mask, masked_heads

METRICS = ("accuracy", "ece", "brier", "nll", "mean_confidence")


def metrics(confidences, correctness):
    conf = np.clip(np.asarray(list(confidences), dtype=float), 0.0, 1.0)
    corr = np.asarray(list(correctness), dtype=bool).astype(float)
    if conf.size == 0:
        return dict.fromkeys(METRICS, float("nan"))

    edges = np.linspace(0.0, 1.0, NUM_BINS + 1)
    ece = 0.0
    for index in range(NUM_BINS):
        lower, upper = edges[index], edges[index + 1]
        picked = (conf >= lower) & (conf <= upper) if index == 0 else (conf > lower) & (conf <= upper)
        if picked.any():
            ece += picked.mean() * abs(corr[picked].mean() - conf[picked].mean())

    return {
        "accuracy": float(corr.mean()),
        "ece": float(ece),
        "brier": float(np.mean((conf - corr) ** 2)),
        "nll": float(-np.mean(corr * np.log(conf + 1e-12) + (1.0 - corr) * np.log(1.0 - conf + 1e-12))),
        "mean_confidence": float(conf.mean()),
    }


class Scorer:
    def __init__(self, model, tokenizer):
        self.model = model
        self.tokenizer = tokenizer
        self.device = next(model.parameters()).device
        self.chg = CHG(model)
        self.choice_ids = {
            label: sorted(
                {
                    int(tokenizer.encode(variant, add_special_tokens=False)[0])
                    for variant in (label, f" {label}", label.lower(), f" {label.lower()}")
                    if tokenizer.encode(variant, add_special_tokens=False)
                }
            )
            for label in CHOICES
        }

    def score(self, prompt, mask=None):
        encoded = self.tokenizer(prompt, return_tensors="pt").to(self.device)
        with torch.no_grad():
            if mask is None:
                logits = self.model(**encoded).logits
            else:
                with self.chg.register_mask_hooks(mask.unsqueeze(0).to(self.device)):
                    logits = self.model(**encoded).logits

        last = logits[0, -1, :].detach().float().cpu()
        pooled = torch.stack([torch.logsumexp(last[self.choice_ids[label]], dim=0) for label in CHOICES])
        probabilities = torch.softmax(pooled, dim=0)
        best = int(torch.argmax(probabilities))
        return CHOICES[best], float(probabilities[best])

    def run(self, frame, mask=None, desc="scoring"):
        answers, confidences, correctness = [], [], []
        for row in tqdm(frame.itertuples(index=False), total=len(frame), desc=desc, dynamic_ncols=True):
            answer, confidence = self.score(str(row.prompt), mask)
            answers.append(answer)
            confidences.append(confidence)
            correctness.append(answer == str(row.gold_answer))
        return answers, confidences, correctness


def score_pool(scorer, frame, desc="scoring"):
    answers, confidences, correctness = scorer.run(frame, desc=desc)
    scored = frame.copy()
    scored["predicted_answer"] = answers
    scored["confidence"] = confidences
    scored["is_correct"] = correctness
    scored["calibration_class"] = [
        f"{'correct' if is_correct else 'wrong'}_{'high' if confidence >= CONFIDENCE_THRESHOLD else 'low'}"
        for is_correct, confidence in zip(correctness, confidences, strict=True)
    ]
    return scored


def _group_index(frame):
    classes = frame["calibration_class"].astype(str).tolist()
    groups = {"all": list(range(len(classes)))}
    groups.update({name: [i for i, value in enumerate(classes) if value == name] for name in CLASSES})
    return groups


def _table(rule, count, groups, confidences, correctness, base):
    rows = []
    for name, index in groups.items():
        current = metrics([confidences[i] for i in index], [correctness[i] for i in index])
        row = {"mask_rule": rule, "calibration_class": name, "masked_heads": count, "rows": len(index), **current}
        if base is not None:
            row.update({f"delta_{key}": current[key] - base[name][key] for key in METRICS})
        rows.append(row)
    return rows


def evaluate(scorer, frame, artifacts, rules, seed=0):
    confidences = frame["confidence"].astype(float).tolist()
    correctness = frame["is_correct"].astype(bool).tolist()
    groups = _group_index(frame)

    base = {
        name: metrics([confidences[i] for i in index], [correctness[i] for i in index])
        for name, index in groups.items()
    }
    rows = _table("baseline", 0, groups, confidences, correctness, None)

    for rule, top_k in rules:
        masked = masked_heads(artifacts, rule, top_k, seed=seed)
        label = f"{rule}_top_{top_k}"
        _, rule_conf, rule_corr = scorer.run(frame, keep_mask(artifacts, masked), desc=label)
        rows.extend(_table(label, len(masked), groups, rule_conf, rule_corr, base))

    return pd.DataFrame(rows)
