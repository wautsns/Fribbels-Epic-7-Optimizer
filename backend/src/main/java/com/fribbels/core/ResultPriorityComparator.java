package com.fribbels.core;

import com.fribbels.model.HeroStats;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Orders builds the same way the optimizer orders its results.
 *
 * <p>Fields from the hero's configured result priority are compared first:
 * preferred fields descending, disliked fields ascending. When all configured
 * fields are equal, the priority, build score, score and damage fields remain
 * deterministic fallbacks.</p>
 *
 * <p>The comparator is best-first: {@code compare(left, right) < 0} means
 * {@code left} should be listed before {@code right}.</p>
 */
public class ResultPriorityComparator implements Comparator<HeroStats> {

    private final List<String> orderedFields;
    private final List<String> dislikedFields;

    public ResultPriorityComparator(final List<String> orderedFields, final List<String> dislikedFields) {
        this.orderedFields = orderedFields == null
                ? Collections.emptyList()
                : new ArrayList<>(orderedFields);
        this.dislikedFields = dislikedFields == null
                ? Collections.emptyList()
                : new ArrayList<>(dislikedFields);
    }

    public List<String> getOrderedFields() {
        return orderedFields;
    }

    @Override
    public int compare(final HeroStats left, final HeroStats right) {
        for (final String field : orderedFields) {
            final int comparison = dislikedFields.contains(field)
                    ? Integer.compare(valueOf(right, field), valueOf(left, field))
                    : Integer.compare(valueOf(left, field), valueOf(right, field));
            if (comparison != 0) {
                return -comparison;
            }
        }

        int comparison = Integer.compare(left.getPriority(), right.getPriority());
        if (comparison != 0) {
            return -comparison;
        }

        comparison = Integer.compare(left.getBs(), right.getBs());
        if (comparison != 0) {
            return -comparison;
        }

        comparison = Integer.compare(left.getScore(), right.getScore());
        if (comparison != 0) {
            return -comparison;
        }

        return -Integer.compare(left.getDmg(), right.getDmg());
    }

    /**
     * Maps a result priority field name to the matching build stat.
     *
     * @param stats build to read the stat from
     * @param field result priority field name
     * @return stat value, or 0 for unknown fields
     */
    public static int valueOf(final HeroStats stats, final String field) {
        switch (field) {
            case "atk": return stats.getAtk();
            case "def": return stats.getDef();
            case "hp": return stats.getHp();
            case "spd": return stats.getSpd();
            case "cr": return stats.getCr();
            case "cd": return stats.getCd();
            case "eff": return stats.getEff();
            case "res": return stats.getRes();
            case "ehp": return stats.getEhp();
            case "dmg": return stats.getDmg();
            case "mcdmg": return stats.getMcdmg();
            case "dmgh": return stats.getDmgh();
            case "dmgd": return stats.getDmgd();
            case "s1": return stats.getS1();
            case "s2": return stats.getS2();
            case "s3": return stats.getS3();
            case "score": return stats.getScore();
            case "bs": return stats.getBs();
            case "priority": return stats.getPriority();
            default: return 0;
        }
    }
}
