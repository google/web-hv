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

import android.app.Instrumentation;
import android.os.Looper;
import android.os.SystemClock;
import android.util.SparseLongArray;
import android.view.KeyEvent;
import android.view.MotionEvent;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayDeque;
import java.util.Queue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class InputServer implements Runnable {

    private static final ExecutorService COMMAND_EXECUTOR = Executors.newSingleThreadExecutor();

    private final Instrumentation mIt = new Instrumentation();
    private final SparseLongArray mKeyDowntimes = new SparseLongArray();

    private long mLastMotionDowntime = -1;
    private final Queue<InputItem> mInputQueue = new ArrayDeque<>();

    public void onServerMessage(String msg) {
        String[] parts = msg.split(":");
        if (parts.length < 1) {
            System.out.println("Invalid message: " + msg);
            return;
        }

        final boolean handled;
        switch (parts[0]) {
            case "me":
                handled = handleMotionEvent(parts);
                break;
            case "ke":
                handled = handleKeyEvent(parts);
                break;
            default:
                handled = false;
                break;
        }
        if (!handled) {
            System.out.println("Invalid message: " + msg);
        }
    }

    private boolean handleKeyEvent(String[] parts) {
        if (parts.length < 7) {
            return false;
        }
        long now = SystemClock.uptimeMillis();
        int code = Integer.parseInt(parts[6]);

        final int action;
        switch (parts[1]) {
            case "d":
                action = KeyEvent.ACTION_DOWN;
                mKeyDowntimes.put(code, now);
                break;
            case "u":
                action = KeyEvent.ACTION_UP;
                break;
            default:
                return false;
        }

        int meta = 0;
        if ("1".equals(parts[2])) meta |= KeyEvent.META_ALT_MASK;
        if ("1".equals(parts[3])) meta |= KeyEvent.META_CTRL_MASK;
        if ("1".equals(parts[4])) meta |= KeyEvent.META_META_MASK;
        if ("1".equals(parts[5])) meta |= KeyEvent.META_SHIFT_MASK;

        long downTime = mKeyDowntimes.get(code, now);
        KeyEvent ke = new KeyEvent(downTime, now, action, code, 0, meta);
        COMMAND_EXECUTOR.execute(new KeyCommand(ke));
        return true;
    }

    private boolean handleMotionEvent(String[] parts) {
        if (parts.length < 5) {
            return false;
        }
        long now = SystemClock.uptimeMillis();
        final int action;
        switch (parts[1]) {
            case "d":
                action = MotionEvent.ACTION_DOWN;
                break;
            case "m":
                action = MotionEvent.ACTION_MOVE;
                break;
            case "u":
                action = MotionEvent.ACTION_UP;
                break;
            default:
                return false;
        }

        float x = Float.parseFloat(parts[2]);
        float y = Float.parseFloat(parts[3]);

        InputItem item = new InputItem(action, x, y, now);
        synchronized (mInputQueue) {
            mInputQueue.add(item);
            COMMAND_EXECUTOR.execute(this);
        }
        return true;
    }

    @Override
    public void run() {
        boolean downPending = mLastMotionDowntime < 0;
        InputItem it;

        while (true) {
            synchronized (mInputQueue) {
                it = mInputQueue.poll();
            }
            if (it == null) {
                return;
            }
            if (downPending && (it.x < 0 || it.y < 0)) {
                // keep looking for event
            } else {
                break;
            }
        }
        if (downPending) {
            mLastMotionDowntime = it.time;
        }

        if (it.action != MotionEvent.ACTION_DOWN && downPending) {
            // Send a down event
            MotionEvent ev = it.obtainEv();
            ev.setAction(MotionEvent.ACTION_DOWN);
            mIt.sendPointerSync(ev);
            ev.recycle();
            downPending = false;
        }

        if (it.action == MotionEvent.ACTION_MOVE) {
            MotionEvent ev = it.obtainEv();
            while (true) {
                synchronized (mInputQueue) {
                    it = mInputQueue.poll();
                }
                if (it == null || it.action != MotionEvent.ACTION_MOVE) {
                    break;
                }
                ev.addBatch(it.time, it.x, it.y, 0, 0, 0);
            }
            mIt.sendPointerSync(ev);
            ev.recycle();

            if (it == null) {
                return;
            }
        }

        MotionEvent ev = it.obtainEv();
        mIt.sendPointerSync(ev);
        ev.recycle();

        if (it.action == MotionEvent.ACTION_UP) {
            mLastMotionDowntime = -1;
        }
    }

    private final class InputItem {

        final int action;
        final float x, y;
        final long time;

        InputItem(int action, float x, float y, long time) {
            this.action = action;
            this.x = x;
            this.y = y;
            this.time = time;
        }

        public MotionEvent obtainEv() {
            return MotionEvent.obtain(mLastMotionDowntime, time, action, x, y, 0);
        }
    }

    private class KeyCommand implements Runnable {

        final KeyEvent event;

        KeyCommand(KeyEvent event) {
            this.event = event;
        }

        @Override
        public void run() {
            mIt.sendKeySync(event);
        }
    }

    public static void main(String[] args) throws Exception {
        Looper.prepareMainLooper();
        InputServer server = new InputServer();
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
        System.out.println("Ready");
        while (true) {
            server.onServerMessage(reader.readLine());
        }
    }
}
