package ai.agentlens.sdk;

import ai.agentlens.sdk.exception.QuotaExceededException;
import ai.agentlens.sdk.model.Event;
import org.junit.jupiter.api.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class BatchSenderTest {

    private Path tempDir;

    @BeforeEach
    void setUp() throws Exception {
        tempDir = Files.createTempDirectory("agentlens-test");
    }

    @AfterEach
    void tearDown() throws Exception {
        // Clean up temp files
        try (var files = Files.walk(tempDir)) {
            files.sorted(Comparator.reverseOrder())
                    .forEach(p -> { try { Files.delete(p); } catch (Exception ignored) {} });
        }
    }

    @Test
    void testFlushAtThreshold() throws Exception {
        CopyOnWriteArrayList<List<Event>> batches = new CopyOnWriteArrayList<>();

        BatchSender sender = new BatchSender(
                events -> { batches.add(new ArrayList<>(events)); return CompletableFuture.completedFuture(null); },
                new BatchSenderOptions()
                        .setMaxBatchSize(3)
                        .setFlushInterval(Duration.ofHours(1)) // won't trigger in test
                        .setBufferDir(tempDir)
        );

        for (int i = 0; i < 3; i++) {
            Event e = new Event();
            e.setId("e" + i);
            sender.enqueue(e);
        }

        // Give async send time to complete
        Thread.sleep(100);
        assertEquals(1, batches.size());
        assertEquals(3, batches.get(0).size());
        sender.close();
    }

    @Test
    void testFlushOnTimer() throws Exception {
        CopyOnWriteArrayList<List<Event>> batches = new CopyOnWriteArrayList<>();

        BatchSender sender = new BatchSender(
                events -> { batches.add(new ArrayList<>(events)); return CompletableFuture.completedFuture(null); },
                new BatchSenderOptions()
                        .setMaxBatchSize(100)
                        .setFlushInterval(Duration.ofMillis(100))
                        .setBufferDir(tempDir)
        );

        Event e = new Event();
        e.setId("e1");
        sender.enqueue(e);

        Thread.sleep(300);
        assertFalse(batches.isEmpty());
        sender.close();
    }

    @Test
    void testShutdownDrains() throws Exception {
        CopyOnWriteArrayList<List<Event>> batches = new CopyOnWriteArrayList<>();

        BatchSender sender = new BatchSender(
                events -> { batches.add(new ArrayList<>(events)); return CompletableFuture.completedFuture(null); },
                new BatchSenderOptions()
                        .setMaxBatchSize(100)
                        .setFlushInterval(Duration.ofHours(1))
                        .setBufferDir(tempDir)
        );

        Event e = new Event();
        e.setId("e1");
        sender.enqueue(e);

        sender.shutdown(Duration.ofSeconds(5)).join();
        assertEquals(1, batches.size());
        assertEquals(1, batches.get(0).size());
    }

    @Test
    void testOverflowDropsOldest() throws Exception {
        CopyOnWriteArrayList<List<Event>> batches = new CopyOnWriteArrayList<>();

        BatchSender sender = new BatchSender(
                events -> { batches.add(new ArrayList<>(events)); return CompletableFuture.completedFuture(null); },
                new BatchSenderOptions()
                        .setMaxBatchSize(100)
                        .setMaxQueueSize(3)
                        .setFlushInterval(Duration.ofHours(1))
                        .setBufferDir(tempDir)
        );

        for (int i = 0; i < 5; i++) {
            Event e = new Event();
            e.setId("e" + i);
            sender.enqueue(e);
        }

        sender.shutdown(Duration.ofSeconds(5)).join();
        assertEquals(1, batches.size());
        // Should have at most 3 events (overflow dropped oldest)
        assertTrue(batches.get(0).size() <= 3);
    }

    @Test
    void testQuotaExceededBuffersToDisk() throws Exception {
        AtomicInteger callCount = new AtomicInteger();

        BatchSender sender = new BatchSender(
                events -> {
                    callCount.incrementAndGet();
                    CompletableFuture<Void> f = new CompletableFuture<>();
                    f.completeExceptionally(new QuotaExceededException());
                    return f;
                },
                new BatchSenderOptions()
                        .setMaxBatchSize(2)
                        .setFlushInterval(Duration.ofHours(1))
                        .setBufferDir(tempDir)
        );

        for (int i = 0; i < 2; i++) {
            Event e = new Event();
            e.setId("e" + i);
            sender.enqueue(e);
        }

        Thread.sleep(200);
        sender.close();

        // Should have written a buffer file
        try (var files = Files.list(tempDir)) {
            long bufferFiles = files.filter(p -> p.getFileName().toString().startsWith("agentlens-buffer")).count();
            assertTrue(bufferFiles > 0, "Expected buffer file to be written");
        }
    }

    @Test
    void testManualFlush() throws Exception {
        CopyOnWriteArrayList<List<Event>> batches = new CopyOnWriteArrayList<>();

        BatchSender sender = new BatchSender(
                events -> { batches.add(new ArrayList<>(events)); return CompletableFuture.completedFuture(null); },
                new BatchSenderOptions()
                        .setMaxBatchSize(100)
                        .setFlushInterval(Duration.ofHours(1))
                        .setBufferDir(tempDir)
        );

        Event e = new Event();
        e.setId("e1");
        sender.enqueue(e);

        sender.flush().join();
        assertEquals(1, batches.size());
        sender.close();
    }
}
