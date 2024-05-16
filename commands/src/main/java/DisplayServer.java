// Copyright 2024 Google LLC
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

import static android.Manifest.permission.CAPTURE_SECURE_VIDEO_OUTPUT;
import static android.content.pm.PackageManager.PERMISSION_GRANTED;
import static android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_DESTROY_CONTENT_ON_REMOVAL;
import static android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY;
import static android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC;
import static android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_SECURE;
import static android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_SHOULD_SHOW_SYSTEM_DECORATIONS;
import static android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_SUPPORTS_TOUCH;
import static android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_TRUSTED;
import static android.media.MediaCodec.BUFFER_FLAG_CODEC_CONFIG;

import android.app.ActivityThread;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaCodec;
import android.media.MediaCodec.BufferInfo;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.Message;
import android.util.Log;
import android.view.Display;
import android.view.Surface;

import java.io.BufferedReader;
import java.io.Closeable;
import java.io.InputStreamReader;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;

// export CLASSPATH=/data/local/tmp/ds.jar;exec app_process /system/bin DisplayServer 1280 720 240
public class DisplayServer implements Handler.Callback {

    private static final String TAG = "DisplayServer";
    private static final int DISPLAY_FLAGS = VIRTUAL_DISPLAY_FLAG_PUBLIC
            | VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
            | VIRTUAL_DISPLAY_FLAG_SUPPORTS_TOUCH | VIRTUAL_DISPLAY_FLAG_DESTROY_CONTENT_ON_REMOVAL
            | VIRTUAL_DISPLAY_FLAG_TRUSTED
            | VIRTUAL_DISPLAY_FLAG_SHOULD_SHOW_SYSTEM_DECORATIONS;

    private static final int MSG_PREPARE = 1;
    private static final int MSG_DO_FRAME = 2;

    private static final long BUFFER_DEQUEUE_TIMEOUT = 250000;

    private final Context mContext;
    private final DisplayManager mDM;
    private final boolean mIsSecure;

    private final Handler mHandler;
    private final int mWidth;
    private final int mHeight;
    private final int mDpi;

    private byte[] mTempData = new byte[2048];

    private Surface mInputSurface;
    private MediaCodec mMediaCodec;
    private VirtualDisplay mVirtualDisplay;

    private BufferInfo mBufferInfo = new BufferInfo();

    DisplayServer(Context ctx, boolean isSecure, Looper looper, int width, int height, int dpi) {
        mContext = ctx;
        mDM = mContext.getSystemService(DisplayManager.class);
        mIsSecure = isSecure;

        mHandler = new Handler(looper, this);
        mWidth = width;
        mHeight = height;
        mDpi = dpi;
    }

    // Encoder parameters.  We use the same width/height as the virtual display.
    private static final String MIME_TYPE = "video/avc";
    private static final int FRAME_RATE = 15;               // 15fps
    private static final int IFRAME_INTERVAL = 10;          // 10 seconds between I-frames
    private static final int BIT_RATE = 6000000;            // 6Mbps

    private void runEncoder() {
        // Run until we're signaled.
        while (true) {
            int index = mMediaCodec.dequeueOutputBuffer(mBufferInfo, BUFFER_DEQUEUE_TIMEOUT);
            if (index < 0) {
                Log.d(TAG, "dequeueOutputBuffer " + index);
                continue;
            }

            int size = mBufferInfo.size;
            if ((mBufferInfo.flags & BUFFER_FLAG_CODEC_CONFIG) != 0) {
                Log.d(TAG, "Received BUFFER_FLAG_CODEC_CONFIG");
            }
            if (size != 0) {
                ByteBuffer buffer = mMediaCodec.getOutputBuffer(index);

                if (mTempData.length < size) {
                    mTempData = new byte[size];
                }
                buffer.get(mTempData, mBufferInfo.offset, size);
                System.out.write(mTempData, 0, size);
                System.out.flush();
            }
            mMediaCodec.releaseOutputBuffer(index, false);
        }
    }

    @Override
    public boolean handleMessage(Message message) {
        switch (message.what) {
            case MSG_PREPARE: {
                try {
                    final List<Closeable> closeables = new ArrayList<>();

                    // Encoded video resolution matches virtual display.
                    MediaFormat encoderFormat = MediaFormat.createVideoFormat(
                            MIME_TYPE, mWidth, mHeight);
                    encoderFormat.setInteger(MediaFormat.KEY_COLOR_FORMAT,
                            MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
                    encoderFormat.setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE);
                    encoderFormat.setInteger(MediaFormat.KEY_FRAME_RATE, FRAME_RATE);
                    encoderFormat.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, IFRAME_INTERVAL);

                    mMediaCodec = MediaCodec.createEncoderByType(MIME_TYPE);
                    mMediaCodec.configure(encoderFormat, null, null,
                            MediaCodec.CONFIGURE_FLAG_ENCODE);
                    closeables.add(mMediaCodec::release);

                    mInputSurface = mMediaCodec.createInputSurface();
                    closeables.add(mInputSurface::release);
                    mMediaCodec.start();


                    int displayFlags = DISPLAY_FLAGS;
                    if (mIsSecure) {
                        displayFlags |= VIRTUAL_DISPLAY_FLAG_SECURE;
                    }
                    mVirtualDisplay = mDM.createVirtualDisplay("web-hv-projection",
                            mWidth, mHeight, mDpi, mInputSurface, displayFlags);
                    closeables.add(mVirtualDisplay::release);
                    Log.d(TAG, "Preparation complete");

                    Runnable cleanupTask = new Runnable() {
                        @Override
                        public void run() {
                            for (int i = 0; i < closeables.size(); i++) {
                                Closeable closeable = closeables.get(i);
                                try {
                                    closeable.close();
                                } catch (Throwable e) {
                                    Log.e(TAG, "Error cleaning up ", e);
                                }
                            }
                            Log.d(TAG, "Everything cleaned up");
                        }
                    };
                    Runtime.getRuntime().addShutdownHook(new Thread(cleanupTask));
                    return true;
                } catch (Exception e) {
                    Log.e(TAG, "Error preparing", e);
                    return false;
                } finally {
                    ((CountDownLatch) message.obj).countDown();
                }
            }
            case MSG_DO_FRAME: {
                runEncoder();
                return true;
            }
        }
        return false;
    }

    /**
     * Prepares the server and returns the new display
     */
    public Display prepare() throws Exception {
        CountDownLatch wait = new CountDownLatch(1);
        mHandler.sendMessage(Message.obtain(mHandler, MSG_PREPARE, wait));
        wait.await();
        return mVirtualDisplay.getDisplay();
    }

    public void start() {
        mHandler.sendEmptyMessage(MSG_DO_FRAME);
    }

    /**
     * MAin program expects 3 arguments: width, height, dpi
     */
    public static void main(String[] args) throws Exception {
        Looper.prepareMainLooper();
        ActivityThread at = ActivityThread.systemMain();
        Context ctx = at.getSystemContext();

        boolean hasSecureAccess =
                ctx.checkSelfPermission(CAPTURE_SECURE_VIDEO_OUTPUT) == PERMISSION_GRANTED;
        if (!hasSecureAccess) {
            Log.e(TAG, "adb not running as root, secure apps will not be displayed");
        }

        HandlerThread t = new HandlerThread("recording-thread");
        t.start();
        DisplayServer displayServer = new DisplayServer(
                ctx.createPackageContext("com.android.shell", 0),
                hasSecureAccess,
                t.getLooper(),
                Integer.parseInt(args[0]),
                Integer.parseInt(args[1]),
                Integer.parseInt(args[2]));
        int displayId = displayServer.prepare().getDisplayId();
        Log.d(TAG, "Secondary display id " + displayId);
        displayServer.start();

        InputServer inputServer = new InputServer(displayId);
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
        while (true) {
            inputServer.onServerMessage(reader.readLine());
        }
    }
}
