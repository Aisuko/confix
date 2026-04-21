import os
import random
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[2]

MODELS = {
    "gemma2-9b": "google/gemma-2-9b",
    "llama3.1-8b": "meta-llama/Llama-3.1-8B",
    "mistral-7b": "mistralai/Mistral-7B-v0.1",
}

CHOICES = ("A", "B", "C", "D")
CLASSES = ("correct_high", "correct_low", "wrong_high", "wrong_low")

ABLATION_RULES = (
    "wrong_high_facilitating_only",
    "correct_high_non_facilitating_only",
    "correct_high_interfering_only",
    "canonical_union",
    "random_size_matched",
)

CHG_NUM_MASKS = 10
CHG_NUM_UPDATES = 50
CHG_BATCH_SIZE = 32
CHG_THRESHOLD = 0.5
CHG_FIT_ROWS = 40

MAX_INPUT_TOKENS = 1536
CONFIDENCE_THRESHOLD = 0.7
FIT_FRACTION = 0.2
NUM_BINS = 10
EVAL_ROWS = 500
CASE_STUDY_PER_CLASS = 125
CASE_STUDY_PENALTY = 5.0

TOPK_GRID = (2, 4, 6, 8, 10, 12, 16, 20)
DEFAULT_TOP_K = 8
MODEL_TOP_K = {"meta-llama/Llama-3.1-8B": 10}


def resolve_model(name):
    return MODELS.get(name, name)


def top_k_for(model):
    return MODEL_TOP_K.get(resolve_model(model), DEFAULT_TOP_K)


def data_file(dataset):
    return ROOT / "data" / dataset / "prepared.parquet"


def run_dir(dataset, model, seed):
    short = resolve_model(model).rsplit("/", 1)[-1]
    return ROOT / "results" / f"{dataset}_{short}_seed{seed}"


def seed_all(seed):
    os.environ["PYTHONHASHSEED"] = str(seed)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def load_env():
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    token = os.getenv("HF_TOKEN") or os.getenv("hf_token") or os.getenv("HUGGINGFACE_HUB_TOKEN")
    if token:
        os.environ["HF_TOKEN"] = token
        os.environ["HUGGINGFACE_HUB_TOKEN"] = token
