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
            // 选装格式为 0 时没有任何套装组合限制，GPU 侧不需要过滤：全部放行，
            // 属性 / 评分 / 阈值过滤统一由 CPU 在 pass 的 iteration 上计算
            passes[id] = true;
        }
    }
}
