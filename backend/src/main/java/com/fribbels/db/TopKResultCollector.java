package com.fribbels.db;

import com.fribbels.core.ResultPriorityComparator;
import com.fribbels.model.HeroStats;

import java.util.ArrayList;
import java.util.Comparator;
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
    private final ResultPriorityComparator bestFirstComparator;
    private final PriorityQueue<HeroStats> heap;

    public TopKResultCollector(final int capacity) {
        this(capacity, null, null);
    }

    public TopKResultCollector(final int capacity,
                               final List<String> preferredFields,
                               final List<String> dislikedFields) {
        if (capacity <= 0) {
            throw new IllegalArgumentException("Top-K capacity must be positive");
        }
        this.capacity = capacity;
        this.bestFirstComparator = new ResultPriorityComparator(preferredFields, dislikedFields);

        // The heap keeps the current worst result at its head
        final Comparator<HeroStats> worstFirstComparator = (left, right) -> bestFirstComparator.compare(right, left);
        heap = new PriorityQueue<>(capacity, worstFirstComparator);
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

        if (bestFirstComparator.compare(result, heap.peek()) < 0) {
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
        results.sort(bestFirstComparator);
        return results.toArray(new HeroStats[0]);
    }

    /**
     * @return number of results currently retained
     */
    public synchronized int size() {
        return heap.size();
    }
}
