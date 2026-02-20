package ai.agentlens.sdk;

import java.nio.file.Path;
import java.time.Duration;
import java.util.function.Consumer;

/** Configuration options for {@link BatchSender}. */
public class BatchSenderOptions {
    private int maxBatchSize = 100;
    private Duration flushInterval = Duration.ofSeconds(5);
    private int maxQueueSize = 10000;
    private Path bufferDir;
    private Consumer<Exception> onError;

    public BatchSenderOptions() {
        String envDir = System.getenv("AGENTLENS_BUFFER_DIR");
        this.bufferDir = envDir != null ? Path.of(envDir) : Path.of(System.getProperty("java.io.tmpdir"));
    }

    public int getMaxBatchSize() { return maxBatchSize; }
    public BatchSenderOptions setMaxBatchSize(int v) { this.maxBatchSize = v; return this; }
    public Duration getFlushInterval() { return flushInterval; }
    public BatchSenderOptions setFlushInterval(Duration v) { this.flushInterval = v; return this; }
    public int getMaxQueueSize() { return maxQueueSize; }
    public BatchSenderOptions setMaxQueueSize(int v) { this.maxQueueSize = v; return this; }
    public Path getBufferDir() { return bufferDir; }
    public BatchSenderOptions setBufferDir(Path v) { this.bufferDir = v; return this; }
    public Consumer<Exception> getOnError() { return onError; }
    public BatchSenderOptions setOnError(Consumer<Exception> v) { this.onError = v; return this; }
}
