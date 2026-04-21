import torch
from tqdm.auto import tqdm

from .config import (
    CASE_STUDY_PENALTY,
    CHG_BATCH_SIZE,
    CHG_NUM_MASKS,
    CHG_NUM_UPDATES,
    CHG_THRESHOLD,
    CLASSES,
    MAX_INPUT_TOKENS,
)

FACILITATING = "facilitating"
NON_FACILITATING = {"interfering", "irrelevant"}


def fit_heads(api, fit_df, out_dir, num_masks=CHG_NUM_MASKS, batch_size=CHG_BATCH_SIZE):
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in tqdm(CLASSES, desc="chg", unit="class"):
        rows = fit_df[fit_df["calibration_class"] == name].sort_values("example_id")
        if rows.empty:
            continue
        result = api.fit(
            texts=rows["prompt"].astype(str).tolist(),
            targets=rows["predicted_answer"].astype(str).tolist(),
            max_length=MAX_INPUT_TOKENS,
            num_masks=num_masks,
            batch_size=batch_size,
            num_updates=CHG_NUM_UPDATES,
            num_reg_updates=CHG_NUM_UPDATES,
        )
        taxonomy = result.head_taxonomy(threshold=CHG_THRESHOLD)
        torch.save(
            {
                "model_config": result.model_config,
                "heads": [
                    (
                        int(row.layer),
                        int(row.head),
                        float(row.necessary_mask),
                        float(row.sufficient_mask),
                        str(row.taxonomy),
                    )
                    for row in taxonomy.itertuples(index=False)
                ],
            },
            out_dir / f"{name}.pt",
        )
    return out_dir


def load_heads(out_dir):
    return {
        name: torch.load(out_dir / f"{name}.pt", map_location="cpu", weights_only=False)
        for name in CLASSES
        if (out_dir / f"{name}.pt").exists()
    }


def _shape(artifacts):
    for artifact in artifacts.values():
        config = artifact.get("model_config") or {}
        if config.get("num_layers") and config.get("num_heads"):
            return int(config["num_layers"]), int(config["num_heads"])
    layers = max(head[0] for artifact in artifacts.values() for head in artifact["heads"])
    heads = max(head[1] for artifact in artifacts.values() for head in artifact["heads"])
    return layers + 1, heads + 1


def _ranked(rows, taxonomies):
    ranked = {}
    for layer, head, necessary, sufficient, taxonomy in rows:
        if taxonomy not in taxonomies:
            continue
        key = (layer, head)
        score = max(abs(necessary), abs(sufficient))
        ranked[key] = max(score, ranked.get(key, score))
    return ranked


def rule_scores(artifacts):
    wrong_high = artifacts.get("wrong_high", {}).get("heads", [])
    correct_high = artifacts.get("correct_high", {}).get("heads", [])

    protected = set(_ranked(correct_high, {FACILITATING}))
    wrong_high_facilitating = _ranked(wrong_high, {FACILITATING})
    unprotected = {key: score for key, score in wrong_high_facilitating.items() if key not in protected}
    non_facilitating = _ranked(correct_high, NON_FACILITATING)

    penalty = {(layer, head): abs(necessary) for layer, head, necessary, _, _ in correct_high}
    union = dict(non_facilitating)
    for key, score in unprotected.items():
        union[key] = max(score, union.get(key, score))

    return {
        "canonical_union": union,
        "wrong_high_facilitating_only": unprotected,
        "correct_high_non_facilitating_only": non_facilitating,
        "correct_high_interfering_only": _ranked(correct_high, {"interfering"}),
        "case_study_targeted": {
            key: score - CASE_STUDY_PENALTY * penalty.get(key, 0.0)
            for key, score in wrong_high_facilitating.items()
        },
    }


def masked_heads(artifacts, rule, top_k, seed=0):
    if top_k <= 0:
        return set()
    if rule == "random_size_matched":
        layers, heads = _shape(artifacts)
        pool = [(layer, head) for layer in range(layers) for head in range(heads)]
        order = torch.randperm(len(pool), generator=torch.Generator().manual_seed(seed)).tolist()
        return {pool[index] for index in order[:top_k]}
    ranked = rule_scores(artifacts)[rule]
    return {key for key, _ in sorted(ranked.items(), key=lambda item: (-item[1], item[0]))[:top_k]}


def keep_mask(artifacts, masked):
    layers, heads = _shape(artifacts)
    mask = torch.ones(layers, heads)
    for layer, head in masked:
        mask[layer, head] = 0.0
    return mask
