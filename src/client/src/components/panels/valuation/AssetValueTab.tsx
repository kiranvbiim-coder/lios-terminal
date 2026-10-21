import { useEffect, useMemo } from "react";
import { useOverridable } from "@/lib/useOverridable";
import { EditableValue, OverrideStatusBadge } from "@/components/panels/EditableValue";
import { FormulaTooltip } from "@/components/panels/FormulaTooltip";
import { computeLiquidationValue, computeReplacementCost } from "@/lib/valuationModels";
import type { FullBalanceSheetData } from "./types";

interface Props {
  symbol: string;
  curr: string;
  price: number;
  sharesOut: number;
  balanceSheet: FullBalanceSheetData | null;
  onResult?: (equityValue: number | null) => void;
}

type AssumptionKey =
  | "cashRecovery" | "receivablesRecovery" | "inventoryRecovery" | "ppeRecovery" | "otherRecovery" | "liquidationCosts"
  | "receivablesMultiple" | "inventoryMultiple" | "ppeMultiple" | "intangibleRebuildCost";

export default function AssetValueTab({ symbol, curr, price, sharesOut, balanceSheet, onResult }: Props) {
  const ov = useOverridable<AssumptionKey>("AssetValueTab.ov");
  const hasFiledData = balanceSheet !== null;
  const b = balanceSheet;
  const cash = b?.cashAndCashEquivalents ?? 0;
  const receivables = b?.netReceivables ?? 0;
  const inventory = b?.inventory ?? 0;
  const ppe = b?.propertyPlantEquipmentNet ?? 0;
  const otherAssets = b ? Math.max(0, b.totalAssets - cash - receivables - inventory - ppe) : 0;
  const totalLiabilities = b?.totalLiabilities ?? 0;

  const liquidationAssumptions = {
    cashRecovery: ov.getValue("cashRecovery", 100),
    receivablesRecovery: ov.getValue("receivablesRecovery", 80),
    inventoryRecovery: ov.getValue("inventoryRecovery", 60),
    ppeRecovery: ov.getValue("ppeRecovery", 50),
    otherRecovery: ov.getValue("otherRecovery", 25),
    liquidationCosts: ov.getValue("liquidationCosts", 10),
  };
  const replacementAssumptions = {
    receivablesMultiple: ov.getValue("receivablesMultiple", 1),
    inventoryMultiple: ov.getValue("inventoryMultiple", 1.1),
    ppeMultiple: ov.getValue("ppeMultiple", 1.3),
    intangibleRebuildCost: ov.getValue("intangibleRebuildCost", 0),
  };

  const liquidation = useMemo(() => computeLiquidationValue({
    cash, receivables, inventory, ppe, otherAssets, totalLiabilities,
    cashRecoveryPct: liquidationAssumptions.cashRecovery,
    receivablesRecoveryPct: liquidationAssumptions.receivablesRecovery,
    inventoryRecoveryPct: liquidationAssumptions.inventoryRecovery,
    ppeRecoveryPct: liquidationAssumptions.ppeRecovery,
    otherAssetsRecoveryPct: liquidationAssumptions.otherRecovery,
    liquidationCostPct: liquidationAssumptions.liquidationCosts,
  }), [cash, receivables, inventory, ppe, otherAssets, totalLiabilities, liquidationAssumptions.cashRecovery, liquidationAssumptions.receivablesRecovery, liquidationAssumptions.inventoryRecovery, liquidationAssumptions.ppeRecovery, liquidationAssumptions.otherRecovery, liquidationAssumptions.liquidationCosts]);
  const replacement = useMemo(() => computeReplacementCost({
    cash, receivables, inventory, netPPE: ppe, otherOperatingAssets: otherAssets,
    intangibleRebuildCost: replacementAssumptions.intangibleRebuildCost, totalLiabilities,
    receivablesReplacementMultiple: replacementAssumptions.receivablesMultiple,
    inventoryReplacementMultiple: replacementAssumptions.inventoryMultiple,
    ppeReplacementMultiple: replacementAssumptions.ppeMultiple,
  }), [cash, receivables, inventory, ppe, otherAssets, totalLiabilities, replacementAssumptions.intangibleRebuildCost, replacementAssumptions.receivablesMultiple, replacementAssumptions.inventoryMultiple, replacementAssumptions.ppeMultiple]);

  const liquidationPerShare = sharesOut > 0 ? liquidation.liquidationValue / sharesOut : 0;
  const replacementPerShare = sharesOut > 0 ? replacement.reproductionCostOfNetAssets / sharesOut : 0;
  useEffect(() => {
    onResult?.(hasFiledData && Number.isFinite(liquidation.liquidationValue) ? liquidation.liquidationValue : null);
  }, [hasFiledData, liquidation.liquidationValue, onResult]);

  const editPct = (key: AssumptionKey, label: string, value: number) => (
    <EditableValue variant="field" label={label} value={value} suffix="%" decimals={0}
      isOverridden={ov.isOverridden(key)} onReset={() => ov.resetOverride(key)} onChange={v => ov.setOverride(key, Math.max(0, Math.min(100, v)))} />
  );
  const editMultiple = (key: AssumptionKey, label: string, value: number) => (
    <EditableValue variant="field" label={label} value={value} suffix="x" decimals={2}
      isOverridden={ov.isOverridden(key)} onReset={() => ov.resetOverride(key)} onChange={v => ov.setOverride(key, Math.max(0, v))} />
  );

  return (
    <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
      {!hasFiledData && (
        <div className="bg-[hsl(20,90%,50%)/10%] border border-[hsl(20,90%,50%)/40%] p-3 font-terminal text-[8px] text-[hsl(20,90%,60%)]">
          No filed balance-sheet data for {symbol}. Asset value is unavailable until real balance-sheet figures are returned; assumptions remain editable for review.
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <FormulaTooltip formula="(Recovered Assets − Liquidation Costs − Total Liabilities) / Shares Outstanding" className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">LIQUIDATION VALUE / SHARE</FormulaTooltip>
          <div className="font-terminal text-[15px] font-bold text-[hsl(38,95%,55%)]">{curr}{liquidationPerShare.toFixed(2)}</div>
        </div>
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <FormulaTooltip formula="(Cash + Receivables×multiple + Inventory×multiple + PP&E×multiple + Rebuild Cost + Other Assets) − Liabilities" className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">REPLACEMENT VALUE / SHARE</FormulaTooltip>
          <div className="font-terminal text-[15px] font-bold text-[hsl(38,95%,55%)]">{curr}{replacementPerShare.toFixed(2)}</div>
        </div>
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1 block">CURRENT PRICE</span>
          <div className="font-terminal text-[15px] font-bold">{curr}{price.toFixed(2)}</div>
        </div>
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1 block">LIQUIDATION FLOOR</span>
          <div className="font-terminal text-[15px] font-bold">{curr}{(liquidation.liquidationValue / 1e9).toFixed(2)}B</div>
        </div>
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">FORCED-SALE RECOVERY ASSUMPTIONS — CLICK TO EDIT</span>
          <OverrideStatusBadge count={ov.overrideCount} onResetAll={ov.resetAll} />
        </div>
        <p className="font-terminal text-[7px] text-muted-foreground/70 mb-2">Defaults are explicit analyst assumptions, not live recovery data: cash 100%, receivables 80%, inventory 60%, PP&amp;E 50%, other assets 25%, and wind-down costs 10% of gross recovery.</p>
        <div className="grid grid-cols-3 gap-x-4">
          {editPct("cashRecovery", "CASH RECOVERY", liquidationAssumptions.cashRecovery)}
          {editPct("receivablesRecovery", "RECEIVABLES RECOVERY", liquidationAssumptions.receivablesRecovery)}
          {editPct("inventoryRecovery", "INVENTORY RECOVERY", liquidationAssumptions.inventoryRecovery)}
          {editPct("ppeRecovery", "PP&E RECOVERY", liquidationAssumptions.ppeRecovery)}
          {editPct("otherRecovery", "OTHER ASSETS RECOVERY", liquidationAssumptions.otherRecovery)}
          {editPct("liquidationCosts", "WIND-DOWN COSTS", liquidationAssumptions.liquidationCosts)}
        </div>
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-2">REPLACEMENT-COST ASSUMPTIONS</div>
        <div className="grid grid-cols-4 gap-x-4">
          {editMultiple("receivablesMultiple", "RECEIVABLES REPLACEMENT", replacementAssumptions.receivablesMultiple)}
          {editMultiple("inventoryMultiple", "INVENTORY REPLACEMENT", replacementAssumptions.inventoryMultiple)}
          {editMultiple("ppeMultiple", "PP&E REPLACEMENT", replacementAssumptions.ppeMultiple)}
          <EditableValue variant="field" label="INTANGIBLE REBUILD COST" value={replacementAssumptions.intangibleRebuildCost / 1e6} suffix="M" decimals={1}
            isOverridden={ov.isOverridden("intangibleRebuildCost")} onReset={() => ov.resetOverride("intangibleRebuildCost")} onChange={v => ov.setOverride("intangibleRebuildCost", Math.max(0, v * 1e6))} />
        </div>
      </div>

      <div className="bg-[#080808] border border-border p-4 overflow-x-auto scrollbar-thin">
        <div className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-2">FILED BALANCE-SHEET ASSET BRIDGE ({symbol})</div>
        <table className="w-full font-terminal text-[9px]"><thead><tr className="text-muted-foreground border-b border-border/40"><th className="text-left py-1">LINE ITEM</th><th className="text-right py-1">FILED VALUE</th><th className="text-right py-1">LIQUIDATION RECOVERY</th><th className="text-right py-1">REPLACEMENT VALUE</th></tr></thead><tbody>
          <tr><td className="py-1">Cash &amp; equivalents</td><td className="text-right tabular-nums">{curr}{(cash / 1e6).toFixed(1)}M</td><td className="text-right tabular-nums">{curr}{(liquidation.recoveryByCategory.cash / 1e6).toFixed(1)}M</td><td className="text-right tabular-nums">{curr}{(replacement.byCategory.cash / 1e6).toFixed(1)}M</td></tr>
          <tr><td className="py-1">Receivables</td><td className="text-right tabular-nums">{curr}{(receivables / 1e6).toFixed(1)}M</td><td className="text-right tabular-nums">{curr}{(liquidation.recoveryByCategory.receivables / 1e6).toFixed(1)}M</td><td className="text-right tabular-nums">{curr}{(replacement.byCategory.receivables / 1e6).toFixed(1)}M</td></tr>
          <tr><td className="py-1">Inventory</td><td className="text-right tabular-nums">{curr}{(inventory / 1e6).toFixed(1)}M</td><td className="text-right tabular-nums">{curr}{(liquidation.recoveryByCategory.inventory / 1e6).toFixed(1)}M</td><td className="text-right tabular-nums">{curr}{(replacement.byCategory.inventory / 1e6).toFixed(1)}M</td></tr>
          <tr><td className="py-1">PP&amp;E</td><td className="text-right tabular-nums">{curr}{(ppe / 1e6).toFixed(1)}M</td><td className="text-right tabular-nums">{curr}{(liquidation.recoveryByCategory.ppe / 1e6).toFixed(1)}M</td><td className="text-right tabular-nums">{curr}{(replacement.byCategory.ppe / 1e6).toFixed(1)}M</td></tr>
          <tr><td className="py-1">Other assets / intangibles</td><td className="text-right tabular-nums">{curr}{(otherAssets / 1e6).toFixed(1)}M</td><td className="text-right tabular-nums">{curr}{(liquidation.recoveryByCategory.otherAssets / 1e6).toFixed(1)}M</td><td className="text-right tabular-nums">{curr}{(replacement.byCategory.otherOperatingAssets / 1e6).toFixed(1)}M</td></tr>
          <tr className="border-t border-border/40"><td className="py-1 font-bold">Total liabilities (less)</td><td className="text-right tabular-nums">({curr}{(totalLiabilities / 1e6).toFixed(1)}M)</td><td className="text-right tabular-nums">({curr}{(totalLiabilities / 1e6).toFixed(1)}M)</td><td className="text-right tabular-nums">({curr}{(totalLiabilities / 1e6).toFixed(1)}M)</td></tr>
        </tbody></table>
        <p className="font-terminal text-[7px] text-muted-foreground/70 mt-2">Values are derived from the latest filed balance sheet. Replacement cost includes an explicit analyst estimate for off-balance-sheet intangible rebuilding; it is zero until entered and is never inferred from market data.</p>
      </div>
    </div>
  );
}
