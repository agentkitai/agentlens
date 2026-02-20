package ai.agentlens.sdk;

import ai.agentlens.sdk.exception.QuotaExceededException;
import ai.agentlens.sdk.model.Event;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * Batches events and sends them periodically or when a size threshold is reached.
 *
 * <p>On 402 (quota exceeded), the batch is serialized to disk for later retry.
 * Implements {@link AutoCloseable} for use with try-with-resources.
 */
public class BatchSender implements AutoCloseable {

    private final Function<List<Event>, CompletableFuture<Void>> sendFn;
    private final int maxBatchSize;
    private final int maxQueueSize;
    private final Path bufferDir;
    private final Consumer<Exception> onError;
    private final ObjectMapper objectMapper;

    private final LinkedList<Event> queue = new LinkedList<>();
    private final ReentrantLock lock = new ReentrantLock();
    private final ScheduledExecutorService scheduler;
    private volatile boolean shutdown = false;

    /**
     * Create a new BatchSender.
     *
     * @param sendFn  function that sends a batch of events
     * @param options configuration options
     */
    public BatchSender(Function<List<Event>, CompletableFuture<Void>> sendFn, BatchSenderOptions options) {
        this.sendFn = sendFn;
        this.maxBatchSize = options.getMaxBatchSize();
        this.maxQueueSize = options.getMaxQueueSize();
        this.bufferDir = options.getBufferDir();
        this.onError = options.getOnError() != null ? options.getOnError() : e -> {};
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());

        this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "agentlens-batch-sender");
            t.setDaemon(true);
            return t;
        });

        long intervalMs = options.getFlushInterval().toMillis();
        this.scheduler.scheduleAtFixedRate(this::timerFlush, intervalMs, intervalMs, TimeUnit.MILLISECONDS);
    }

    /**
     * Enqueue an event for batched sending.
     * Auto-flushes when the queue reaches {@code maxBatchSize}.
     */
    public void enqueue(Event event) {
        if (shutdown) return;
        lock.lock();
        try {
            // Drop oldest if at capacity
            while (queue.size() >= maxQueueSize) {
                queue.removeFirst();
            }
            queue.addLast(event);

            if (queue.size() >= maxBatchSize) {
                List<Event> batch = drainBatch();
                sendBatchAsync(batch);
            }
        } finally {
            lock.unlock();
        }
    }

    /** Manually trigger an immediate flush. */
    public CompletableFuture<Void> flush() {
        List<Event> batch;
        lock.lock();
        try {
            batch = drainBatch();
        } finally {
            lock.unlock();
        }
        if (batch.isEmpty()) return CompletableFuture.completedFuture(null);
        return sendBatchAsync(batch);
    }

    /**
     * Shutdown the sender: stop the timer, drain remaining events.
     *
     * @param timeout maximum time to wait for pending flushes
     * @return future that completes when shutdown is done
     */
    public CompletableFuture<Void> shutdown(Duration timeout) {
        shutdown = true;
        scheduler.shutdown();
        return flush().orTimeout(timeout.toMillis(), TimeUnit.MILLISECONDS)
                .exceptionally(e -> null);
    }

    @Override
    public void close() {
        shutdown(Duration.ofSeconds(30)).join();
    }

    private void timerFlush() {
        try {
            flush().join();
        } catch (Exception e) {
            onError.accept(e);
        }
    }

    private List<Event> drainBatch() {
        int size = Math.min(queue.size(), maxBatchSize);
        if (size == 0) return List.of();
        List<Event> batch = new ArrayList<>(size);
        for (int i = 0; i < size; i++) {
            batch.add(queue.removeFirst());
        }
        return batch;
    }

    private CompletableFuture<Void> sendBatchAsync(List<Event> batch) {
        if (batch.isEmpty()) return CompletableFuture.completedFuture(null);
        return sendFn.apply(batch).exceptionally(e -> {
            if (e instanceof QuotaExceededException || (e.getCause() instanceof QuotaExceededException)) {
                bufferToDisk(batch);
            } else {
                onError.accept(e instanceof Exception ex ? ex : new RuntimeException(e));
            }
            return null;
        });
    }

    private void bufferToDisk(List<Event> events) {
        try {
            Files.createDirectories(bufferDir);
            String filename = String.format("agentlens-buffer-%d-%s.json",
                    System.currentTimeMillis(),
                    UUID.randomUUID().toString().substring(0, 8));
            Path file = bufferDir.resolve(filename);
            objectMapper.writeValue(file.toFile(), events);
        } catch (IOException e) {
            onError.accept(e);
        }
    }
}
