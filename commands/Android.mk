LOCAL_PATH:= $(call my-dir)

include $(CLEAR_VARS)
LOCAL_SRC_FILES := MethodList.java
LOCAL_MODULE := MethodList

LOCAL_SDK_VERSION := 28
include $(BUILD_JAVA_LIBRARY)

include $(CLEAR_VARS)
LOCAL_SRC_FILES := ProcessIcon.java
LOCAL_MODULE := ProcessIcon

LOCAL_SDK_VERSION := 28
include $(BUILD_JAVA_LIBRARY)
