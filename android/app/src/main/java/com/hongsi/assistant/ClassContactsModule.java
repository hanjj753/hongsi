package com.hongsi.assistant;

import android.content.ContentProviderOperation;
import android.content.ContentProviderResult;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds.GroupMembership;
import android.provider.ContactsContract.CommonDataKinds.Phone;
import android.provider.ContactsContract.CommonDataKinds.StructuredName;
import android.provider.ContactsContract.Data;
import android.provider.ContactsContract.Groups;
import android.provider.ContactsContract.RawContacts;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/** Saves a class roster to the device address book. No contact data is sent to a server. */
public class ClassContactsModule extends ReactContextBaseJavaModule {
    private final ContentResolver resolver;

    public ClassContactsModule(ReactApplicationContext context) {
        super(context);
        resolver = context.getContentResolver();
    }

    @Override public String getName() { return "ClassContacts"; }

    private static String digits(String phone) {
        String normalized = phone == null ? "" : phone.replaceAll("[^0-9]", "");
        if (normalized.startsWith("82") && normalized.length() >= 11) return "0" + normalized.substring(2);
        return normalized;
    }

    private long findRawContact(String phone) {
        Uri lookup = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phone));
        try (Cursor matches = resolver.query(lookup,
                new String[]{ContactsContract.PhoneLookup._ID}, null, null, null)) {
            if (matches == null) return -1;
            while (matches.moveToNext()) {
                long contactId = matches.getLong(0);
                try (Cursor numbers = resolver.query(Phone.CONTENT_URI,
                        new String[]{Phone.RAW_CONTACT_ID, Phone.NUMBER},
                        Phone.CONTACT_ID + "=?", new String[]{Long.toString(contactId)}, null)) {
                    if (numbers == null) continue;
                    while (numbers.moveToNext()) {
                        if (digits(numbers.getString(1)).equals(digits(phone))) return numbers.getLong(0);
                    }
                }
            }
        }
        return -1;
    }

    private String[] accountFor(long rawId) {
        try (Cursor cursor = resolver.query(RawContacts.CONTENT_URI,
                new String[]{RawContacts.ACCOUNT_NAME, RawContacts.ACCOUNT_TYPE},
                RawContacts._ID + "=? AND " + RawContacts.DELETED + "=0",
                new String[]{Long.toString(rawId)}, null)) {
            if (cursor != null && cursor.moveToFirst()) return new String[]{cursor.getString(0), cursor.getString(1)};
        }
        throw new IllegalStateException("기존 연락처의 저장 계정을 찾지 못했습니다.");
    }

    private long ensureGroup(String title, String[] account, Map<String, Long> cache) {
        String key = title + "\u0000" + account[0] + "\u0000" + account[1];
        if (cache.containsKey(key)) return cache.get(key);
        String accountWhere = account[0] == null && account[1] == null
                ? Groups.ACCOUNT_NAME + " IS NULL AND " + Groups.ACCOUNT_TYPE + " IS NULL"
                : Groups.ACCOUNT_NAME + "=? AND " + Groups.ACCOUNT_TYPE + "=?";
        String[] args = account[0] == null && account[1] == null
                ? new String[]{title} : new String[]{title, account[0], account[1]};
        try (Cursor cursor = resolver.query(Groups.CONTENT_URI, new String[]{Groups._ID},
                Groups.TITLE + "=? AND " + Groups.DELETED + "=0 AND " + accountWhere,
                args, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                long id = cursor.getLong(0);
                cache.put(key, id);
                return id;
            }
        }
        ContentValues values = new ContentValues();
        values.put(Groups.TITLE, title);
        values.put(Groups.GROUP_VISIBLE, 1);
        if (account[0] != null) values.put(Groups.ACCOUNT_NAME, account[0]);
        if (account[1] != null) values.put(Groups.ACCOUNT_TYPE, account[1]);
        Uri created = resolver.insert(Groups.CONTENT_URI, values);
        if (created == null) throw new IllegalStateException("이 기기의 연락처 계정에 그룹을 만들 수 없습니다.");
        long id = Long.parseLong(created.getLastPathSegment());
        cache.put(key, id);
        return id;
    }

    private long nameRow(long rawId) {
        try (Cursor cursor = resolver.query(Data.CONTENT_URI, new String[]{Data._ID},
                Data.RAW_CONTACT_ID + "=? AND " + Data.MIMETYPE + "=?",
                new String[]{Long.toString(rawId), StructuredName.CONTENT_ITEM_TYPE}, null)) {
            return cursor != null && cursor.moveToFirst() ? cursor.getLong(0) : -1;
        }
    }

    private boolean hasMembership(long rawId, long groupId) {
        try (Cursor cursor = resolver.query(Data.CONTENT_URI, new String[]{Data._ID},
                Data.RAW_CONTACT_ID + "=? AND " + Data.MIMETYPE + "=? AND " + GroupMembership.GROUP_ROW_ID + "=?",
                new String[]{Long.toString(rawId), GroupMembership.CONTENT_ITEM_TYPE, Long.toString(groupId)}, null)) {
            return cursor != null && cursor.moveToFirst();
        }
    }

    private boolean renameAndGroup(long rawId, String name, long groupId) throws Exception {
        ArrayList<ContentProviderOperation> ops = new ArrayList<>();
        long existingNameRow = nameRow(rawId);
        if (existingNameRow >= 0) {
            ops.add(ContentProviderOperation.newUpdate(Data.CONTENT_URI)
                    .withSelection(Data._ID + "=?", new String[]{Long.toString(existingNameRow)})
                    .withValue(StructuredName.DISPLAY_NAME, name)
                    .withValue(StructuredName.GIVEN_NAME, name)
                    .withValue(StructuredName.FAMILY_NAME, null)
                    .withValue(StructuredName.MIDDLE_NAME, null).build());
        } else {
            ops.add(ContentProviderOperation.newInsert(Data.CONTENT_URI)
                    .withValue(Data.RAW_CONTACT_ID, rawId)
                    .withValue(Data.MIMETYPE, StructuredName.CONTENT_ITEM_TYPE)
                    .withValue(StructuredName.DISPLAY_NAME, name)
                    .withValue(StructuredName.GIVEN_NAME, name).build());
        }
        boolean newMembership = !hasMembership(rawId, groupId);
        if (newMembership) ops.add(ContentProviderOperation.newInsert(Data.CONTENT_URI)
                .withValue(Data.RAW_CONTACT_ID, rawId)
                .withValue(Data.MIMETYPE, GroupMembership.CONTENT_ITEM_TYPE)
                .withValue(GroupMembership.GROUP_ROW_ID, groupId).build());
        resolver.applyBatch(ContactsContract.AUTHORITY, ops);
        return newMembership;
    }

    private void createContact(String name, String phone, long groupId) throws Exception {
        ArrayList<ContentProviderOperation> ops = new ArrayList<>();
        // Some Contacts providers crash when an insert operation has null ContentValues.
        // Explicit null account fields create a local raw contact and keep values non-null.
        ops.add(ContentProviderOperation.newInsert(RawContacts.CONTENT_URI)
                .withValue(RawContacts.ACCOUNT_NAME, null)
                .withValue(RawContacts.ACCOUNT_TYPE, null).build());
        ops.add(ContentProviderOperation.newInsert(Data.CONTENT_URI)
                .withValueBackReference(Data.RAW_CONTACT_ID, 0)
                .withValue(Data.MIMETYPE, StructuredName.CONTENT_ITEM_TYPE)
                .withValue(StructuredName.DISPLAY_NAME, name)
                .withValue(StructuredName.GIVEN_NAME, name).build());
        ops.add(ContentProviderOperation.newInsert(Data.CONTENT_URI)
                .withValueBackReference(Data.RAW_CONTACT_ID, 0)
                .withValue(Data.MIMETYPE, Phone.CONTENT_ITEM_TYPE)
                .withValue(Phone.NUMBER, phone)
                .withValue(Phone.TYPE, Phone.TYPE_MOBILE).build());
        ops.add(ContentProviderOperation.newInsert(Data.CONTENT_URI)
                .withValueBackReference(Data.RAW_CONTACT_ID, 0)
                .withValue(Data.MIMETYPE, GroupMembership.CONTENT_ITEM_TYPE)
                .withValue(GroupMembership.GROUP_ROW_ID, groupId).build());
        ContentProviderResult[] result = resolver.applyBatch(ContactsContract.AUTHORITY, ops);
        if (result.length != 4 || result[0].uri == null) throw new IllegalStateException("연락처 저장에 실패했습니다.");
    }

    @ReactMethod
    public void syncContacts(String groupName, ReadableArray entries, Promise promise) {
        new Thread(() -> {
            try {
                if (groupName == null || groupName.trim().isEmpty()) throw new IllegalArgumentException("분기 이름이 없습니다.");
                Map<String, Long> groupCache = new HashMap<>();
                int created = 0, updated = 0, failed = 0;
                String firstError = null;
                for (int i = 0; i < entries.size(); i++) {
                    try {
                        ReadableMap entry = entries.getMap(i);
                        String name = entry.getString("name");
                        String phone = digits(entry.getString("phone"));
                        if (name == null || name.trim().isEmpty() || phone.length() < 9) {
                            throw new IllegalArgumentException("이름이나 전화번호가 올바르지 않습니다.");
                        }
                        long rawId = findRawContact(phone);
                        String[] account = rawId < 0 ? new String[]{null, null} : accountFor(rawId);
                        long groupId = ensureGroup(groupName.trim(), account, groupCache);
                        if (rawId < 0) {
                            createContact(name.trim(), phone, groupId);
                            created++;
                        } else {
                            renameAndGroup(rawId, name.trim(), groupId);
                            updated++;
                        }
                    } catch (Exception itemError) {
                        failed++;
                        if (firstError == null) firstError = itemError.getMessage();
                    }
                }
                WritableMap result = Arguments.createMap();
                result.putInt("created", created);
                result.putInt("updated", updated);
                result.putInt("failed", failed);
                if (firstError != null) result.putString("firstError", firstError);
                promise.resolve(result);
            } catch (Exception error) {
                promise.reject("CONTACT_SYNC_FAILED", error);
            }
        }).start();
    }
}
