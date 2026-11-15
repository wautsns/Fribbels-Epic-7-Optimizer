package com.fribbels.gpu;

import com.fribbels.model.Hero;
import com.fribbels.model.HeroStats;
import com.fribbels.request.OptimizationRequest;

public class SetFormat000OptimizerKernel extends GpuOptimizerKernel {

    public SetFormat000OptimizerKernel(final OptimizationRequest request, final float[] flattenedWeaponAccs, final float[] flattenedHelmetAccs, final float[] flattenedArmorAccs, final float[] flattenedNecklaceAccs, final float[] flattenedRingAccs, final float[] flattenedBootAccs, final float bonusBaseAtk, final float bonusBaseDef, final float bonusBaseHp, final float atkSetBonus, final float hpSetBonus, final float defSetBonus, final float speedSetBonus, final float revengeSetBonus, final float reversalSetBonus, final float penSetDmgBonus, final float targetDefense, final float bonusMaxAtk, final float bonusMaxDef, final float bonusMaxHp, final int SETTING_RAGE_SET, final int SETTING_PEN_SET, final HeroStats base, final Hero hero, final long argSize, final long wSize, final long hSize, final long aSize, final long nSize, final long rSize, final long bSize, final long max) {
        super(request, flattenedWeaponAccs, flattenedHelmetAccs, flattenedArmorAccs, flattenedNecklaceAccs, flattenedRingAccs, flattenedBootAccs, bonusBaseAtk, bonusBaseDef, bonusBaseHp, atkSetBonus, hpSetBonus, defSetBonus, speedSetBonus, revengeSetBonus, reversalSetBonus, penSetDmgBonus, targetDefense, bonusMaxAtk, bonusMaxDef, bonusMaxHp, SETTING_RAGE_SET, SETTING_PEN_SET, base, hero, argSize, wSize, hSize, aSize, nSize, rSize, bSize, max);
    }

    @Override
    public void run() {
        final int id = getGlobalId();

        final long i = max * iteration + id;
        if (i < wSize * hSize * aSize * nSize * rSize * bSize) {
            // 选装格式为 0 时没有套装组合限制（全放行 boolArr=true），
            // 但面板 stats filter 和 GpuOptimizerKernel 完全一样，统一在 GPU 里算最终面板属性并比较阈值。
            final long b = i % bSize;
            final long r = ( ( i - b ) / bSize ) %  rSize;
            final long n = ( ( i - r * bSize - b ) / (bSize * rSize) ) % nSize;
            final long a = ( ( i - n * rSize * bSize - r * bSize - b ) / (bSize * rSize * nSize) ) % aSize;
            final long h = ( ( i - a * nSize * rSize * bSize - n * rSize * bSize - r * bSize - b) / (bSize * rSize * nSize * aSize) ) % hSize;
            final long w = ( ( i - h * aSize * nSize * rSize * bSize - a * nSize * rSize * bSize - n * rSize * bSize - r * bSize - b) / (bSize * rSize * nSize * aSize * hSize) ) % wSize;

            final int wargSize = (int)(w * argSize);
            final float wSet   = flattenedWeaponAccs[wargSize + 12];
            final int hargSize = (int)(h * argSize);
            final float hSet   = flattenedHelmetAccs[hargSize + 12];
            final int aargSize = (int)(a * argSize);
            final float aSet   = flattenedArmorAccs[aargSize + 12];
            final int nargSize = (int)(n * argSize);
            final float nSet   = flattenedNecklaceAccs[nargSize + 12];
            final int rargSize = (int)(r * argSize);
            final float rSet   = flattenedRingAccs[rargSize + 12];
            final int bargSize = (int)(b * argSize);
            final float bSet   = flattenedBootAccs[bargSize + 12];

            // accumulator 汇总（float 加法，与 CPU 一致）
            final float atkSum = flattenedWeaponAccs[wargSize+0] + flattenedHelmetAccs[hargSize+0] + flattenedArmorAccs[aargSize+0] + flattenedNecklaceAccs[nargSize+0] + flattenedRingAccs[rargSize+0] + flattenedBootAccs[bargSize+0];
            final float hpSum  = flattenedWeaponAccs[wargSize+1] + flattenedHelmetAccs[hargSize+1] + flattenedArmorAccs[aargSize+1] + flattenedNecklaceAccs[nargSize+1] + flattenedRingAccs[rargSize+1] + flattenedBootAccs[bargSize+1];
            final float defSum = flattenedWeaponAccs[wargSize+2] + flattenedHelmetAccs[hargSize+2] + flattenedArmorAccs[aargSize+2] + flattenedNecklaceAccs[nargSize+2] + flattenedRingAccs[rargSize+2] + flattenedBootAccs[bargSize+2];
            final float crSum  = flattenedWeaponAccs[wargSize+6] + flattenedHelmetAccs[hargSize+6] + flattenedArmorAccs[aargSize+6] + flattenedNecklaceAccs[nargSize+6] + flattenedRingAccs[rargSize+6] + flattenedBootAccs[bargSize+6];
            final float cdSum  = flattenedWeaponAccs[wargSize+7] + flattenedHelmetAccs[hargSize+7] + flattenedArmorAccs[aargSize+7] + flattenedNecklaceAccs[nargSize+7] + flattenedRingAccs[rargSize+7] + flattenedBootAccs[bargSize+7];
            final float effSum = flattenedWeaponAccs[wargSize+8] + flattenedHelmetAccs[hargSize+8] + flattenedArmorAccs[aargSize+8] + flattenedNecklaceAccs[nargSize+8] + flattenedRingAccs[rargSize+8] + flattenedBootAccs[bargSize+8];
            final float resSum = flattenedWeaponAccs[wargSize+9] + flattenedHelmetAccs[hargSize+9] + flattenedArmorAccs[aargSize+9] + flattenedNecklaceAccs[nargSize+9] + flattenedRingAccs[rargSize+9] + flattenedBootAccs[bargSize+9];
            final float spdSum = flattenedWeaponAccs[wargSize+10] + flattenedHelmetAccs[hargSize+10] + flattenedArmorAccs[aargSize+10] + flattenedNecklaceAccs[nargSize+10] + flattenedRingAccs[rargSize+10] + flattenedBootAccs[bargSize+10];

            // set index
            final int wsi = (int) wSet;
            final int hsi = (int) hSet;
            final int asi = (int) aSet;
            final int nsi = (int) nSet;
            final int rsi = (int) rSet;
            final int bsi = (int) bSet;

            // set bonus（与父类 GpuOptimizerKernel 完全一致）
            final int atkSetCount = (wsi==2?1:0)+(hsi==2?1:0)+(asi==2?1:0)+(nsi==2?1:0)+(rsi==2?1:0)+(bsi==2?1:0);
            final float atkSetB = atkSetCount > 3 ? atkSetBonus : 0;

            final int hp0Count = (wsi==0?1:0)+(hsi==0?1:0)+(asi==0?1:0)+(nsi==0?1:0)+(rsi==0?1:0)+(bsi==0?1:0);
            final int hp20Count = (wsi==20?1:0)+(hsi==20?1:0)+(asi==20?1:0)+(nsi==20?1:0)+(rsi==20?1:0)+(bsi==20?1:0);
            final int hp17Count = (wsi==17?1:0)+(hsi==17?1:0)+(asi==17?1:0)+(nsi==17?1:0)+(rsi==17?1:0)+(bsi==17?1:0);
            final float hpSetB = (hp0Count > 1 ? hp0Count/2 * hpSetBonus : 0) + (hp20Count > 3 ? hpSetBonus : 0) + (hp17Count > 1 ? hp17Count/2 * hpSetBonus / -2 : 0);

            final int defSetCount = (wsi==1?1:0)+(hsi==1?1:0)+(asi==1?1:0)+(nsi==1?1:0)+(rsi==1?1:0)+(bsi==1?1:0);
            final float defSetB = defSetCount > 1 ? defSetCount/2 * defSetBonus : 0;

            final int crSetCount = (wsi==4?1:0)+(hsi==4?1:0)+(asi==4?1:0)+(nsi==4?1:0)+(rsi==4?1:0)+(bsi==4?1:0);
            final int crSetB = crSetCount > 1 ? crSetCount/2 * 12 : 0;

            final int cdSetCount = (wsi==6?1:0)+(hsi==6?1:0)+(asi==6?1:0)+(nsi==6?1:0)+(rsi==6?1:0)+(bsi==6?1:0);
            final int cdSetB = cdSetCount > 3 ? 60 : 0;

            final int effSetCount = (wsi==5?1:0)+(hsi==5?1:0)+(asi==5?1:0)+(nsi==5?1:0)+(rsi==5?1:0)+(bsi==5?1:0);
            final int effSetB = effSetCount > 1 ? effSetCount/2 * 20 : 0;

            final int resSetCount = (wsi==9?1:0)+(hsi==9?1:0)+(asi==9?1:0)+(nsi==9?1:0)+(rsi==9?1:0)+(bsi==9?1:0);
            final int resSetB = resSetCount > 1 ? resSetCount/2 * 20 : 0;

            final int spd3Count = (wsi==3?1:0)+(hsi==3?1:0)+(asi==3?1:0)+(nsi==3?1:0)+(rsi==3?1:0)+(bsi==3?1:0);
            final int spd14Count = (wsi==14?1:0)+(hsi==14?1:0)+(asi==14?1:0)+(nsi==14?1:0)+(rsi==14?1:0)+(bsi==14?1:0);
            final int spd18Count = (wsi==18?1:0)+(hsi==18?1:0)+(asi==18?1:0)+(nsi==18?1:0)+(rsi==18?1:0)+(bsi==18?1:0);
            final int spd22Count = (wsi==22?1:0)+(hsi==22?1:0)+(asi==22?1:0)+(nsi==22?1:0)+(rsi==22?1:0)+(bsi==22?1:0);
            final float spdSetB = (spd3Count > 3 ? speedSetBonus : 0) + (spd14Count > 3 ? revengeSetBonus : 0) + (spd18Count > 3 ? reversalSetBonus : 0) + (spd22Count > 3 ? reversalSetBonus : 0);

            // 最终面板属性
            final int finalAtk = (int)((bonusBaseAtk + atkSum + atkSetB) * bonusMaxAtk);
            final int finalHp  = (int)((bonusBaseHp  + hpSum  + hpSetB)  * bonusMaxHp);
            final int finalDef = (int)((bonusBaseDef + defSum + defSetB) * bonusMaxDef);
            final int finalCr  = (int)(baseCr  + crSum  + crSetB  + bonusCr  + aeiCr);
            final int finalCd  = (int)(baseCd  + cdSum  + cdSetB  + bonusCd  + aeiCd);
            final int finalEff = (int)(baseEff + effSum + effSetB + bonusEff + aeiEff);
            final int finalRes = (int)(baseRes + resSum + resSetB + bonusRes + aeiRes);
            final int finalSpd = (int)(baseSpeed + spdSum + spdSetB + bonusSpeed + aeiSpeed);

            // 8 项 stats filter
            passes[id] =
                finalAtk  >= inputAtkMinLimit  && finalAtk  <= inputAtkMaxLimit  &&
                finalHp   >= inputHpMinLimit   && finalHp   <= inputHpMaxLimit   &&
                finalDef  >= inputDefMinLimit  && finalDef  <= inputDefMaxLimit  &&
                finalSpd  >= inputSpdMinLimit  && finalSpd  <= inputSpdMaxLimit  &&
                finalCr   >= inputCrMinLimit   && finalCr   <= inputCrMaxLimit   &&
                finalCd   >= inputCdMinLimit   && finalCd   <= inputCdMaxLimit   &&
                finalEff  >= inputEffMinLimit  && finalEff  <= inputEffMaxLimit  &&
                finalRes  >= inputResMinLimit  && finalRes  <= inputResMaxLimit;
        }
    }
}
