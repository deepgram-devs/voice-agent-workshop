package agent;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;

/** Collects the agent's linear16 audio and writes one WAV file at the end. */
public final class WavSink {
    private final Path path;
    private final ByteArrayOutputStream audio = new ByteArrayOutputStream();
    private volatile int sampleRate;
    private boolean closed;

    public WavSink(Path path) {
        this(path, 24000);
    }

    public WavSink(Path path, int sampleRate) {
        this.path = path;
        this.sampleRate = sampleRate;
    }

    public void sampleRate(int rate) {
        sampleRate = rate;
    }

    public synchronized void write(byte[] chunk) {
        if (!closed) audio.write(chunk, 0, chunk.length);
    }

    /** Writes the file once: its path, or null when no audio came (or it was written already). */
    public synchronized Path close() throws IOException {
        if (closed || audio.size() == 0) {
            closed = true;
            return null;
        }
        closed = true;
        byte[] data = audio.toByteArray();
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put("RIFF".getBytes(java.nio.charset.StandardCharsets.US_ASCII)).putInt(36 + data.length);
        header.put("WAVE".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        header.put("fmt ".getBytes(java.nio.charset.StandardCharsets.US_ASCII)).putInt(16);
        header.putShort((short) 1).putShort((short) 1); // PCM, mono
        header.putInt(sampleRate).putInt(sampleRate * 2).putShort((short) 2).putShort((short) 16);
        header.put("data".getBytes(java.nio.charset.StandardCharsets.US_ASCII)).putInt(data.length);
        Path parent = path.toAbsolutePath().getParent();
        if (parent != null) Files.createDirectories(parent);
        byte[] file = new byte[44 + data.length];
        System.arraycopy(header.array(), 0, file, 0, 44);
        System.arraycopy(data, 0, file, 44, data.length);
        Files.write(path, file);
        return path;
    }
}
