import hashlib

import pandas as pd

from .config import CHOICES, EVAL_ROWS, FIT_FRACTION, data_file

COLUMNS = ("example_id", "dataset_name", "prompt", "gold_answer", "subject")


def build_prompt(question, choices):
    options = "\n".join(f"{label}. {text.strip()}" for label, text in zip(CHOICES, choices, strict=True))
    return (
        "Answer the following multiple choice question with a single letter: A, B, C, or D.\n\n"
        f"Question: {str(question).strip()}\n\n{options}\n\nAnswer:"
    )


def _label(value):
    return {"1": "A", "2": "B", "3": "C", "4": "D"}.get(str(value).strip().upper(), str(value).strip().upper())


def _mmlu(frame):
    return [
        (row.question, [str(c).strip() for c in list(row.choices)], CHOICES[int(row.answer)], str(row.subject))
        for row in frame.itertuples(index=False)
    ]


def _medqa(frame):
    records = []
    for row in frame.itertuples(index=False):
        gold = _label(row.answer_idx)
        if gold in CHOICES:
            texts = [str(row.options[label]).strip() for label in CHOICES]
            records.append((row.question, texts, gold, str(row.meta_info)))
    return records


def _openbookqa(frame):
    records = []
    for row in frame.itertuples(index=False):
        labels = [_label(label) for label in row.choices["label"]]
        gold = _label(row.answerKey)
        if labels == list(CHOICES) and gold in CHOICES:
            texts = [str(text).strip() for text in row.choices["text"]]
            records.append((row.question_stem, texts, gold, "openbookqa"))
    return records


def _sciq(frame):
    records = []
    for row in frame.itertuples(index=False):
        position = len(records) % len(CHOICES)
        texts = [str(row.distractor1).strip(), str(row.distractor2).strip(), str(row.distractor3).strip()]
        texts.insert(position, str(row.correct_answer).strip())
        records.append((row.question, texts, CHOICES[position], "sciq"))
    return records


def _medmcqa(frame):
    records = []
    for row in frame.itertuples(index=False):
        try:
            gold = int(row.cop)
        except (TypeError, ValueError):
            continue
        if 0 <= gold < len(CHOICES):
            texts = [str(row.opa).strip(), str(row.opb).strip(), str(row.opc).strip(), str(row.opd).strip()]
            records.append((row.question, texts, CHOICES[gold], str(row.subject_name)))
    return records


DATASETS = {
    "mmlu_all_test": ("cais/mmlu", "all", ("test",), _mmlu),
    "medqa_usmle_4_options": ("GBaker/MedQA-USMLE-4-options", None, ("train", "test"), _medqa),
    "openbookqa": ("allenai/openbookqa", "main", ("train", "validation", "test"), _openbookqa),
    "sciq": ("allenai/sciq", None, ("train", "validation", "test"), _sciq),
    "medmcqa": ("openlifescienceai/medmcqa", None, ("train", "validation"), _medmcqa),
}


def prepare(dataset, n=None):
    from datasets import load_dataset

    hub_id, config, splits, normalise = DATASETS[dataset]
    records = []
    for split in splits:
        records.extend(normalise(load_dataset(hub_id, config, split=split).to_pandas()))
    if n is not None:
        records = records[:n]

    frame = pd.DataFrame.from_records(
        [
            {
                "example_id": index,
                "dataset_name": dataset,
                "prompt": build_prompt(question, choices),
                "gold_answer": gold,
                "subject": subject,
            }
            for index, (question, choices, gold, subject) in enumerate(records)
        ],
        columns=list(COLUMNS),
    )
    path = data_file(dataset)
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(path, index=False)
    return path, len(frame)


def load(dataset, n=None):
    frame = pd.read_parquet(data_file(dataset))
    if n is not None:
        frame = frame.head(n)
    return frame.reset_index(drop=True)


def _subject_seed(seed, subject):
    return int(hashlib.sha256(f"{seed}:{subject}".encode()).hexdigest()[:8], 16)


def split_pools(dataset, seed=0, n=None, eval_rows=EVAL_ROWS):
    frame = load(dataset, n)
    fit, held = [], []
    for subject, group in frame.groupby("subject", sort=True, dropna=False):
        ordered = group.sort_values("example_id")
        take = min(max(1, round(len(ordered) * FIT_FRACTION)), len(ordered))
        shuffled = ordered.sample(frac=1.0, random_state=_subject_seed(seed, str(subject)))
        fit.append(shuffled.head(take))
        held.append(shuffled.iloc[take:])

    fit_df = pd.concat(fit).sort_values("example_id").reset_index(drop=True)
    eval_df = pd.concat(held).sort_values("example_id").reset_index(drop=True)
    if eval_rows and len(eval_df) > eval_rows:
        eval_df = eval_df.sample(n=eval_rows, random_state=seed).sort_values("example_id").reset_index(drop=True)
    return fit_df, eval_df
