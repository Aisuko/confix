import argparse

import pandas as pd
from inteprelens import LensAPI

from .config import (
    ABLATION_RULES,
    CASE_STUDY_PER_CLASS,
    CHG_BATCH_SIZE,
    CHG_FIT_ROWS,
    CHG_NUM_MASKS,
    CLASSES,
    TOPK_GRID,
    load_env,
    resolve_model,
    run_dir,
    seed_all,
    top_k_for,
)
from .data import DATASETS, prepare, split_pools
from .evaluate import Scorer, evaluate, score_pool
from .heads import fit_heads, load_heads

STAGES = ("main", "ablation", "hyperparameter", "case-study")


def balanced_pool(frame, per_class, seed):
    pools = [frame[frame["calibration_class"] == name] for name in CLASSES]
    take = min([per_class, *(len(pool) for pool in pools)])
    if take == 0:
        raise SystemExit("Every calibration class needs at least one fit-pool row.")
    parts = [pool.sample(n=take, random_state=seed) for pool in pools]
    return pd.concat(parts).sort_values("example_id").reset_index(drop=True)


def report(frame, path, title):
    frame.to_csv(path, index=False)
    print(f"\n=== {title} ===")
    print(frame.to_string(index=False))


def experiment(args):
    model = resolve_model(args.model)
    out = run_dir(args.dataset, model, args.seed)
    out.mkdir(parents=True, exist_ok=True)
    top_k = args.top_k or top_k_for(model)

    api = LensAPI.from_pretrained(model, device=args.device)
    scorer = Scorer(api.model, api.tokenizer)

    fit_path, eval_path = out / "scored_fit.parquet", out / "scored_eval.parquet"
    if fit_path.exists() and eval_path.exists() and not args.rescore:
        fit_df, eval_df = pd.read_parquet(fit_path), pd.read_parquet(eval_path)
    else:
        fit_rows, eval_rows = split_pools(args.dataset, args.seed, args.n)
        fit_df = score_pool(scorer, fit_rows, "fit pool")
        eval_df = score_pool(scorer, eval_rows, "eval pool")
        fit_df.to_parquet(fit_path, index=False)
        eval_df.to_parquet(eval_path, index=False)

    chg_dir = out / "chg"
    if args.refit or not any(chg_dir.glob("*.pt")):
        chg_rows = balanced_pool(fit_df, CHG_FIT_ROWS // len(CLASSES), args.seed)
        fit_heads(api, chg_rows, chg_dir, args.num_masks, args.batch_size)
    artifacts = load_heads(chg_dir)

    if "main" in args.stages:
        table = evaluate(scorer, eval_df, artifacts, [("canonical_union", top_k)], args.seed)
        report(table, out / "main.csv", f"Main table (top_k={top_k})")

    if "ablation" in args.stages:
        rules = [(rule, top_k) for rule in ABLATION_RULES]
        table = evaluate(scorer, eval_df, artifacts, rules, args.seed)
        report(table[table["calibration_class"] == "all"], out / "ablation.csv", "Ablation (mask rules)")

    if "hyperparameter" in args.stages:
        rules = [("canonical_union", value) for value in TOPK_GRID]
        table = evaluate(scorer, eval_df, artifacts, rules, args.seed)
        report(table[table["calibration_class"] == "all"], out / "hyperparameter.csv", "Hyperparameter (top-k)")

    if "case-study" in args.stages:
        pool = balanced_pool(fit_df, CASE_STUDY_PER_CLASS, args.seed)
        table = evaluate(scorer, pool, artifacts, [("case_study_targeted", top_k)], args.seed)
        report(table[table["calibration_class"] != "all"], out / "case_study.csv", "Case study (per class)")


def main():
    parser = argparse.ArgumentParser(prog="calibration.run")
    parser.add_argument("command", choices=("prepare", "experiment"))
    parser.add_argument("--dataset", default="mmlu_all_test", choices=list(DATASETS))
    parser.add_argument("--model", default="llama3.1-8b")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", default=None)
    parser.add_argument("--stages", nargs="+", default=["main", "ablation", "hyperparameter"], choices=STAGES)
    parser.add_argument("--top-k", type=int, default=None)
    parser.add_argument("--num-masks", type=int, default=CHG_NUM_MASKS)
    parser.add_argument("--batch-size", type=int, default=CHG_BATCH_SIZE)
    parser.add_argument("--n", type=int, default=None)
    parser.add_argument("--rescore", action="store_true")
    parser.add_argument("--refit", action="store_true")
    args = parser.parse_args()

    load_env()
    seed_all(args.seed)
    if args.command == "prepare":
        path, rows = prepare(args.dataset, args.n)
        print(f"{args.dataset}: rows={rows} -> {path}")
    else:
        experiment(args)


if __name__ == "__main__":
    main()
