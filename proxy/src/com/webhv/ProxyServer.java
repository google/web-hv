// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package com.webhv;

import java.io.Closeable;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Properties;
import java.util.Scanner;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ProxyServer {

    private static final Executor HANDSHAKE_EXECUTOR = Executors.newFixedThreadPool(10);
    private static final String HANDSHAKE_KEY = "handshake_key";
    private static final boolean DEBUG = false;
    private static final int VERSION = 1;

    private static final int STANDARD_ERROR_CODE = 4010;
    private static final int SAFE_CLOSE_CODE = 4015;

    public static void main(String[] args) {
        // Initialize signature
        File propsFile = new File(System.getProperty("user.home"), ".webhv_proxy");

        Properties prop = new Properties();
        String key = null;

        try (FileReader r = new FileReader(propsFile)) {
            prop.load(r);
            key = prop.getProperty(HANDSHAKE_KEY);
        } catch (Exception e) { }

        if (key == null || key.length() < 5) {
            // Generate new key
            key = UUID.randomUUID().toString();
            prop.setProperty(HANDSHAKE_KEY, key);
            try (FileWriter w = new FileWriter(propsFile)) {
                prop.store(w, "Settings for WehHVProxy");
            } catch (IOException e) {
                System.out.println("Error saving handshake key");
            }
        }

        new ProxyServer(key).doServerLoop();
    }

    final String handshakeKey;

    ProxyServer(String handshakeKey) {
        System.out.println("Handshake key: " + handshakeKey);
        this.handshakeKey = VERSION + "-" + handshakeKey;
    }

    private void doServerLoop() {
        int portNumber = 8000;
        System.out.println("Starting server at " + portNumber);
        try (ServerSocket server = new ServerSocket(portNumber)) {
            while (true) {
                Socket clientSocket = server.accept();
                HANDSHAKE_EXECUTOR.execute(() -> handleWebRequestAsync(clientSocket));
            }
        } catch (IOException e) {
            System.out.println("Closing server");
        }
    }


    private void handleWebRequestAsync(Socket webSocket) {
        InputStream webIn;
        OutputStream webOut;
        String request;

        try {
            webIn = webSocket.getInputStream();
            webOut = webSocket.getOutputStream();
            request = doWebsocketHandshake(webIn, webOut);
        } catch (Exception e) {
            // Handshake failed
            closeSafely(webSocket);
            return;
        }

        String device = null;
        String command;

        int split = request.indexOf('/');
        if (split > 0) {
            device = request.substring(0, split);
        }
        command = URLDecoder.decode(request.substring(split + 1), StandardCharsets.UTF_8);
        if (DEBUG) {
            System.out.println("Making connection  " + device + ", " + command);
        }

        // Device list
        Socket adbSocket = null;
        InputStream adbIn;
        OutputStream adbOut;

        try {
            try {
                adbSocket = new Socket("localhost", 5037);
                adbIn = adbSocket.getInputStream();
                adbOut = adbSocket.getOutputStream();
            } catch (Exception e) {
                throw new Exception("Unable to connect to ADB server", e);
            }

            if (device == null) {
                adbOut.write(prefixLength("host:" + command).getBytes());
                adbOut.flush();
            } else {
                adbOut.write(prefixLength("host:transport:" + device).getBytes());
                adbOut.flush();

                // Wait for first okay
                if (!new String(adbIn.readNBytes(4)).equalsIgnoreCase("OKAY")) {
                    throw new IOException("ADB connection error");
                }
                adbOut.write(prefixLength(command).getBytes());
                adbOut.flush();
            }

            // Wait for a single OKAY
            if (!new String(adbIn.readNBytes(4)).equalsIgnoreCase("OKAY")) {
                throw new IOException("ADB connection error");
            }
        } catch (Exception e) {
            // Error opening adb socket
            try {
                webOut.write(encodeClose(STANDARD_ERROR_CODE, e.getMessage()));
                webOut.flush();
            } catch (IOException e2) { }
            closeSafely(webSocket);
            closeSafely(adbSocket);
            return;
        }

        // All done. Start connection threads
        CancelSignal cancelSignal = new CancelSignal(webSocket, adbSocket);
        new InputOutputLoop("adbIn:" + command, adbIn, webOut, cancelSignal,  new AdbToWebMapper()).start();
        new InputOutputLoop("webIn:"+command, webIn, adbOut, cancelSignal, this::transferWebToOut).start();
    }

    private static String prefixLength(String command) {
        String prefix = Integer.toHexString(command.length());
        while (prefix.length() < 4) prefix = "0" + prefix;
        return prefix + command;
    }

    private void transferWebToOut(InputStream in, OutputStream out) throws IOException {
        byte[] header = in.readNBytes(2);
        if (header[0] == (byte) 136) {
            // Socket closed
            if (DEBUG) {
                System.out.println("Close requested");
            }
            out.write(encodeClose(SAFE_CLOSE_CODE, "Safe close"));
            out.flush();
            out.close();
            return;
        }

        // header[0] => text or binary
        byte op = (byte) 127;
        byte rLength = (byte) (header[1] & op);
        final int length;

        if (rLength == (byte) 126) {
            byte[] size = in.readNBytes(2);
            length = (Byte.toUnsignedInt(size[0]) << 8)
                    + Byte.toUnsignedInt(size[1]);
        } else if (rLength == (byte) 127) {
            byte[] size = in.readNBytes(8);
            long longLength = (Byte.toUnsignedInt(size[0]) << 56)
                    + (Byte.toUnsignedInt(size[1]) << 48)
                    + (Byte.toUnsignedInt(size[2]) << 40)
                    + (Byte.toUnsignedInt(size[3]) << 32)
                    + (Byte.toUnsignedInt(size[4]) << 24)
                    + (Byte.toUnsignedInt(size[5]) << 16)
                    + (Byte.toUnsignedInt(size[6]) << 8)
                    + Byte.toUnsignedInt(size[7]);
            length = (int) longLength;
        } else {
            length = (int) rLength;
        }
        byte[] masks = in.readNBytes(4);
        byte[] message = in.readNBytes(length);
        for (int i = 0; i < length; i++) {
            message[i] = (byte) (message[i] ^ masks[i % 4]);
        }
        out.write(message);
        out.flush();
    }

    public static byte[] encodeClose(int code, String reason) {
        byte[] reasonData = reason.getBytes();
        byte[] reply = new byte[reasonData.length + 4];
        reply[0] = (byte) 136;
        reply[1] = (byte) (reasonData.length + 2);
        reply[2] = (byte) ((code >> 8) & (byte) 255);
        reply[3] = (byte) (code & (byte) 255);
        System.arraycopy(reasonData, 0, reply, 4, reasonData.length);
        return reply;
    }

    private String doWebsocketHandshake(InputStream in, OutputStream out) throws Exception {
        String data = new Scanner(in, "UTF-8").useDelimiter("\\r\\n\\r\\n").next();
        Matcher get = Pattern.compile("^GET .*").matcher(data);
        if (!get.find()) {
            throw new Exception("Unknown request type");
        }

        String errorMessage = null;

        String key = getRequestParam(data, "Sec-WebSocket-Key");
        String protocol = getRequestParam(data, "Sec-WebSocket-Protocol");
        if (key == null || protocol == null) {
            throw new Exception("Invalid socket header");
        }
        if (!handshakeKey.equals(protocol)) {
            errorMessage = "Invalid handshake key. Copy the key from webhv-proxy output";
            if (!protocol.startsWith(VERSION + "-")) {
                errorMessage = "Wrong proxy version, re-download webhv-proxy";
            }
        }

        byte[] response = ("HTTP/1.1 101 Switching Protocols\r\n"
                + "Connection: Upgrade\r\n"
                + "Upgrade: websocket\r\n"
                + "Sec-WebSocket-Protocol: " + protocol + "\r\n"
                + "Sec-WebSocket-Accept: "
                + Base64.getEncoder().encodeToString(
                MessageDigest.getInstance("SHA-1").digest(
                        (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes("UTF-8")))
                + "\r\n\r\n")
                .getBytes("UTF-8");

        out.write(response, 0, response.length);
        out.flush();

        if (errorMessage != null) {
            out.write(encodeClose(STANDARD_ERROR_CODE, errorMessage));
            out.flush();
            throw new IOException("Wrong client");
        }

        String request = get.group().split("\\s+")[1];
        if (request.startsWith("/")) {
            request = request.substring(1);
        }
        return request;
    }

    private static String getRequestParam(String req, String paramKey) {
        Matcher match = Pattern.compile(paramKey + ": (.*)").matcher(req);
        return match.find() ? match.group(1) : null;
    }

    private static class InputOutputLoop extends Thread {

        final String name;
        final InputStream input;
        final OutputStream output;
        final CancelSignal signal;
        final IOMapper mapper;

        InputOutputLoop(String name, InputStream in, OutputStream out, CancelSignal signal, IOMapper mapper) {
            this.name = name;
            this.input = in;
            this.output = out;
            this.signal = signal;
            this.mapper = mapper;
        }

        @Override
        public void run() {
            try (InputStream in = input; OutputStream out = output) {
                while (!signal.isCancelled()) {
                    mapper.map(in, out);
                }
            } catch (Exception e) { }
            signal.cancel(name);
        }
    }

    private static class AdbToWebMapper implements IOMapper {
        private final byte[] readBuffer = new byte[2048];

        @Override
        public void map(InputStream in, OutputStream out) throws IOException {
            int count = in.read(readBuffer);
            if (count == -1) {
                throw new IOException("Input closed");
            }
            if (count > 0) {
                out.write(encode(readBuffer, count));
                out.flush();
            }
        }

        private byte[] encode(byte[] data, int length) {
            final int frameCount;

            byte[] frame = new byte[10];
            // 129 -> text, 130 bytes
            frame[0] = (byte) 130;

            if (length <= 125) {
                frame[1] = (byte) length;
                frameCount = 2;
            } else if (length >= 126 && length <= 65535) {
                frame[1] = (byte) 126;
                int len = length;
                frame[2] = (byte) ((len >> 8) & (byte)255);
                frame[3] = (byte) (len & (byte)255);
                frameCount = 4;
            } else {
                frame[1] = (byte) 127;
                long len = length; //note an int is not big enough in java
                frame[2] = (byte) ((len >> 56 ) & (byte) 255);
                frame[3] = (byte) ((len >> 48 ) & (byte) 255);
                frame[4] = (byte) ((len >> 40 ) & (byte) 255);
                frame[5] = (byte) ((len >> 32 ) & (byte) 255);
                frame[6] = (byte) ((len >> 24 ) & (byte) 255);
                frame[7] = (byte) ((len >> 16 ) & (byte) 255);
                frame[8] = (byte) ((len >> 8 ) & (byte) 255);
                frame[9] = (byte) (len & (byte) 255);
                frameCount = 10;
            }

            byte[] reply = new byte[frameCount + length];
            System.arraycopy(frame, 0, reply, 0, frameCount);
            System.arraycopy(data, 0, reply, frameCount, length);
            return reply;
        }
    }

    private interface IOMapper {
        void map(InputStream in, OutputStream out) throws IOException;
    }

    private static class CancelSignal {

        private boolean cancelled = false;
        private final List<Socket> sockets;

        public CancelSignal(Socket... sockets) {
            this.sockets = Arrays.asList(sockets);
        }

        public boolean isCancelled() {
            return cancelled;
        }

        public void cancel(String source) {
            synchronized (sockets) {
                if (cancelled) {
                    return;
                }
                cancelled = true;
            }
            sockets.forEach(ProxyServer::closeSafely);
            if (DEBUG) {
                System.out.println("Socked closed by " + source);
            }
        }
    }

    private static void closeSafely(Closeable c) {
        try {
            c.close();
        } catch (Exception e) {
            // Ignore
        }
    }
}
