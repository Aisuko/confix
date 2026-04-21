SHELL := /bin/bash

ROOT      := $(shell pwd)
export PYTHONPATH := $(ROOT)/src
PYTHON    := $(ROOT)/.venv/bin/python
RUN       := $(PYTHON) -m calibration.run

MODEL     ?= llama3.1-8b
DATASET   ?= mmlu_all_test
SEED      ?= 0
DEVICE    ?=
TOP_K     ?=
N         ?=

MODELS   := gemma2-9b llama3.1-8b mistral-7b
DATASETS := mmlu_all_test medmcqa openbookqa medqa_usmle_4_options sciq

BASE = $(RUN) experiment --dataset $(DATASET) --model $(MODEL) --seed $(SEED) \
       $(if $(TOP_K),--top-k $(TOP_K),) $(if $(N),--n $(N),) $(if $(DEVICE),--device $(DEVICE),)

.PHONY: prepare main ablation hyperparameter case-study experiment all help

prepare:        ; $(RUN) prepare --dataset $(DATASET) $(if $(N),--n $(N),)

main:           ; $(BASE) --stages main
ablation:       ; $(BASE) --stages ablation
hyperparameter: ; $(BASE) --stages hyperparameter
case-study:     ; $(BASE) --stages case-study
experiment:     ; $(BASE) --stages main ablation hyperparameter case-study

all:
	@set -e; \
	for d in $(DATASETS); do \
		for m in $(MODELS); do \
			echo "=== $$d x $$m (seed $(SEED)) ==="; \
			$(MAKE) --no-print-directory experiment DATASET="$$d" MODEL="$$m" SEED=$(SEED); \
		done; \
	done

help:
	@echo "make <target> [DATASET=$(DATASET)] [MODEL=$(MODEL)] [SEED=$(SEED)] [DEVICE=cuda:0] [TOP_K=10] [N=50]"
	@echo "DATASET : $(DATASETS)"
	@echo "MODEL   : $(MODELS)"
	@echo "targets : prepare"
	@echo "          main ablation hyperparameter case-study"
	@echo "          experiment all"
