#!/usr/bin/env node
import { evaluateSourceAssetBudget } from "./phase4_source_asset_budget.mjs";

const result = evaluateSourceAssetBudget(process.argv[2] ?? "dist/public/assets");
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
if (result.status !== "passed") process.exitCode = 1;
