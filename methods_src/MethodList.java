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

import android.view.View;

import org.json.JSONArray;

import java.lang.reflect.Method;

/**
 * A simple program to dump possible methods defined in {@link View}
 * that can be called using DDMS protocol.
 */
public class MethodList {

    public static void main(String[] args) {
        JSONArray out = new JSONArray();
        for (Method m : View.class.getMethods()) {
            if (m.getName().startsWith("get") || m.getName().startsWith("on") || m.getName().startsWith("is")) {
                continue;
            }
            boolean valid = true;
            String params = "";
            for (Class<?> c : m.getParameterTypes()) {
                if (!params.isEmpty()) {
                    params += ", ";
                }
                if (c == int.class) {
                    params += "int";
                } else if (c == float.class) {
                    params += "float";
                } else if (c == boolean.class) {
                    params += "boolean";
                } else {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                out.put(new JSONArray().put(m.getName()).put(params));
            }
        }
        // Everything initialized. Send OKAY.
        System.out.println("OKAY");
        System.out.println(out);
    }
}