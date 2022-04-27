// Copyright 2018 Google LLC
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

import static android.content.Context.ACTIVITY_SERVICE;
import static android.graphics.Paint.ANTI_ALIAS_FLAG;
import static android.graphics.Paint.DITHER_FLAG;
import static android.graphics.Paint.FILTER_BITMAP_FLAG;

import android.app.ActivityManager;
import android.app.ActivityManager.RunningAppProcessInfo;
import android.content.Context;
import android.content.pm.PackageManager.NameNotFoundException;
import android.graphics.Bitmap;
import android.graphics.Bitmap.CompressFormat;
import android.graphics.Bitmap.Config;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PaintFlagsDrawFilter;
import android.graphics.Rect;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.DrawableWrapper;
import android.os.Build.VERSION;
import android.os.Build.VERSION_CODES;
import android.os.Looper;
import android.util.Base64;

import java.io.ByteArrayOutputStream;

/**
 * Simple program which fetches the app icon for a given process.
 */
public class ProcessIcon {

    // Percent of actual icon size
    private static final float ICON_SIZE_BLUR_FACTOR = 0.5f/48;
    // Percent of actual icon size
    private static final float ICON_SIZE_KEY_SHADOW_DELTA_FACTOR = 1f/48;

    private static final int KEY_SHADOW_ALPHA = 61;
    private static final int AMBIENT_SHADOW_ALPHA = 30;

    private static final int ICON_SIZE = 96;

    public static void main(String[] args) {
        int pid = Integer.parseInt(args[0]);
        Context context = getContext();
        if (context == null) {
            System.out.println("FAIL");
            return;
        }

        String packageName = getPackageName(context, pid);
        if (packageName == null) {
            System.out.println("FAIL");
            return;
        }

        Drawable icon;
        try {
            icon = context.getPackageManager().getApplicationIcon(packageName);
        } catch (NameNotFoundException e) {
            System.out.println("FAIL");
            return;
        }
        icon = wrapIconDrawableWithShadow(icon);

        Bitmap bitmap = Bitmap.createBitmap(ICON_SIZE, ICON_SIZE, Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.setDrawFilter(new PaintFlagsDrawFilter(DITHER_FLAG,
                FILTER_BITMAP_FLAG | ANTI_ALIAS_FLAG));
        canvas.scale(0.1f, 0.1f);

        icon.setBounds(0, 0, ICON_SIZE * 10, ICON_SIZE * 10);
        icon.draw(canvas);

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bitmap.compress(CompressFormat.PNG, 100, out);
        String iconText = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);

        // Everything initialized. Send OKAY.
        System.out.println("OKAY");
        System.out.println(iconText);
    }

    private static String getPackageName(Context context, int pid) {
        ActivityManager am = (ActivityManager) context.getSystemService(ACTIVITY_SERVICE);
        for (RunningAppProcessInfo info : am.getRunningAppProcesses()) {
            if (info.pid == pid) {
                if (info.pkgList.length > 0) {
                    return info.pkgList[0];
                } else {
                    return null;
                }
            }
        }
        return null;
    }

    public static Context getContext() {
        try {
            Looper.prepare();

            Class atc = Class.forName("android.app.ActivityThread");
            Object systemThread = atc.getDeclaredMethod("systemMain").invoke(null);
            return (Context) atc.getDeclaredMethod("getSystemContext").invoke(systemThread);
        } catch (Exception e) {
            return null;
        }
    }

    public static Drawable wrapIconDrawableWithShadow(Drawable drawable) {
        if (VERSION.SDK_INT < VERSION_CODES.O || !(drawable instanceof AdaptiveIconDrawable)) {
            return drawable;
        }
        Bitmap shadow = getShadowBitmap((AdaptiveIconDrawable) drawable);
        return new ShadowDrawable(shadow, drawable);
    }

    private static Bitmap getShadowBitmap(AdaptiveIconDrawable d) {
        int shadowSize = Math.max(ICON_SIZE, d.getIntrinsicHeight());
        d.setBounds(0, 0, shadowSize, shadowSize);

        float blur = ICON_SIZE_BLUR_FACTOR * shadowSize;
        float keyShadowDistance = ICON_SIZE_KEY_SHADOW_DELTA_FACTOR * shadowSize;

        int bitmapSize = (int) (shadowSize + 2 * blur + keyShadowDistance);
        Bitmap shadow = Bitmap.createBitmap(bitmapSize, bitmapSize, Bitmap.Config.ARGB_8888);

        Canvas canvas = new Canvas(shadow);
        canvas.translate(blur + keyShadowDistance / 2, blur);

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.TRANSPARENT);

        // Draw ambient shadow
        paint.setShadowLayer(blur, 0, 0, AMBIENT_SHADOW_ALPHA << 24);
        canvas.drawPath(d.getIconMask(), paint);

        // Draw key shadow
        canvas.translate(0, keyShadowDistance);
        paint.setShadowLayer(blur, 0, 0, KEY_SHADOW_ALPHA << 24);
        canvas.drawPath(d.getIconMask(), paint);
        canvas.setBitmap(null);
        return shadow;
    }

    /**
     * A drawable which draws a shadow bitmap behind a drawable
     */
    private static class ShadowDrawable extends DrawableWrapper {

        private final Bitmap mShadow;
        private final Paint mPaint = new Paint(FILTER_BITMAP_FLAG | ANTI_ALIAS_FLAG);

        public ShadowDrawable(Bitmap shadow, Drawable dr) {
            super(dr);
            mShadow = shadow;
        }

        @Override
        public void draw(Canvas canvas) {
            Rect bounds = getBounds();
            canvas.drawBitmap(mShadow, null, bounds, mPaint);
            canvas.save();
            // Ratio of child drawable size to shadow bitmap size
            float factor = 1 / (1 + 2 * ICON_SIZE_BLUR_FACTOR + ICON_SIZE_KEY_SHADOW_DELTA_FACTOR);

            canvas.translate(
                    bounds.width() * factor *
                            (ICON_SIZE_BLUR_FACTOR + ICON_SIZE_KEY_SHADOW_DELTA_FACTOR / 2),
                    bounds.height() * factor * ICON_SIZE_BLUR_FACTOR);
            canvas.scale(factor, factor);
            super.draw(canvas);
            canvas.restore();
        }
    }
}
