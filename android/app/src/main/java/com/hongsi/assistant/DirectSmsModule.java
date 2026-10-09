package com.hongsi.assistant;

import android.telephony.SmsManager;
import java.util.ArrayList;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;

public class DirectSmsModule extends ReactContextBaseJavaModule {
    public DirectSmsModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "DirectSms";
    }

    @ReactMethod
    public void sendDirectSms(String phoneNumber, String message, Promise promise) {
        try {
            if (phoneNumber == null || phoneNumber.trim().isEmpty() || message == null || message.trim().isEmpty()) {
                promise.reject("INVALID_SMS", "Phone number and message are required");
                return;
            }
            SmsManager smsManager = SmsManager.getDefault();
            ArrayList<String> parts = smsManager.divideMessage(message);

            if (parts.size() > 1) {
                // 쪼개진 개수가 1개보다 많으면(장문이면) 멀티파트로 전송
                smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null);
            } else {
                // 짧은 문자는 기존대로 전송
                smsManager.sendTextMessage(phoneNumber, null, message, null, null);
            }
            // The OS accepted the submission. Carrier delivery is not confirmed here.
            promise.resolve(null);
        } catch (Exception ex) {
            promise.reject("SMS_SUBMISSION_FAILED", ex);
        }
    }
}