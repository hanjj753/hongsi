package com.hongsi.assistant;

import android.telephony.SmsManager;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class DirectSmsModule extends ReactContextBaseJavaModule {
    public DirectSmsModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }
    @Override
    public String getName() {
        return "DirectSms";
    }
    @ReactMethod
    public void sendDirectSms(String phoneNumber, String msg) {
        try {
            SmsManager smsManager = SmsManager.getDefault();
            smsManager.sendTextMessage(phoneNumber, null, msg, null, null);
        } catch (Exception ex) {
            ex.printStackTrace();
        }
    }
}