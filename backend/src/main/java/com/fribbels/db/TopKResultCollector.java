package com.fribbels.db;

import com.fribbels.model.HeroStats;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.PriorityQueue;

/**
 * Thread-safe bounded collector that keeps the best HeroStats results.
 *
 * <p>Preferred fields are compared in their configured order, descending.
 * Disliked fields are compared after them, ascending. The existing priority,
 * build score, score, and damage fields remain deterministic fallbacks when
 * configured fields are equal.</p>
 */
public class TopKResultCollector {

    private final int capacity;
    private final List<String> orderedFields;
    private final List<String> dislikedFields;
    private final PriorityQueue<HeroStats> heap;

    public TopKResultCollector(final int capacity) {
        this(capacity, Collections.emptyList(), Collections.emptyList());
    }

    public TopKResultCollector(final int capacity,
                               final List<String> preferredFields,
                               final List<String> dislikedFields) {
        if (capacity <= 0) {
            throw new IllegalArgumentException("Top-K capacity must be positive");
        }
        this.capacity = capacity;
        this.orderedFields = preferredFields == null
                ? Collections.emptyList()
                : new ArrayList<>(preferredFields);
        this.dislikedFields = dislikedFields == null
                ? Collections.emptyList()
                : new ArrayList<>(dislikedFields);
        heap = new PriorityQueue<>(capacity, this::compareBest);
    }

    /**
     * Offers a result and evicts the current worst result when the heap is full.
     *
     * @param result completed optimization result
     */
    public synchronized void offer(final HeroStats result) {
        if (heap.size() < capacity) {
            heap.offer(result);
            return;
        }

        if (compareBest(result, heap.peek()) > 0) {
            heap.poll();
            heap.offer(result);
        }
    }

    /**
     * Returns retained results in best-first order.
     *
     * @return compact result array sorted by the configured ranking
     */
    public synchronized HeroStats[] toArray() {
        final List<HeroStats> results = new ArrayList<>(heap);
        results.sort((left, right) -> compareBest(right, left));
        return results.toArray(new HeroStats[0]);
    }

    /**
     * @return number of results currently retained
     */
    public synchronized int size() {
        return heap.size();
    }

    /**
     * Compares results from worst to best for PriorityQueue head semantics.
     * A positive value means the left result is better.
     */
    private int compareBest(final HeroStats left, final HeroStats right) {
        for (final String field : orderedFields) {
            final int comparison = dislikedFields.contains(field)
                    ? Integer.compare(valueOf(right, field), valueOf(left, field))
                    : Integer.compare(valueOf(left, field), valueOf(right, field));
            if (comparison != 0) {
                return comparison;
            }
        }

        int comparison = Integer.compare(left.getPriority(), right.getPriority());
        if (comparison != 0) {
            return comparison;
        }

        comparison = Integer.compare(left.getBs(), right.getBs());
        if (comparison != 0) {
            return comparison;
        }

        comparison = Integer.compare(left.getScore(), right.getScore());
        if (comparison != 0) {
            return comparison;
        }

        return Integer.compare(left.getDmg(), right.getDmg());
    }

    private static int valueOf(final HeroStats stats, final String field) {
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
