import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Picker } from "./ReadablePicker";

export type AssistantFormValues = {
  position: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  startDate: string;
  account: string;
  status: string;
};

export const EMPTY_ASSISTANT_FORM: AssistantFormValues = {
  position: "조교",
  name: "",
  phone: "",
  email: "",
  role: "현장",
  startDate: "",
  account: "",
  status: "현역",
};

const POSITION_OPTIONS = ["CEO", "실장", "조교"] as const;
const ROLE_OPTIONS = ["CEO", "실장", "현장", "자료"] as const;
const STATUS_OPTIONS = ["현역", "비근무"] as const;

const splitValues = (value: string) =>
  value.split(",").map(item => item.trim()).filter(Boolean);

export const normalizeAssistantFormValues = (values: AssistantFormValues): AssistantFormValues => {
  const positionValues = splitValues(values.position);
  const selectedRoles = new Set(splitValues(values.role));

  return {
    position: POSITION_OPTIONS.find(option => positionValues.includes(option)) || "조교",
    name: values.name.trim(),
    phone: values.phone.trim(),
    email: values.email.trim().toLowerCase(),
    role: ROLE_OPTIONS.filter(option => selectedRoles.has(option)).join(", "),
    startDate: values.startDate.trim(),
    account: values.account.trim(),
    status: values.status.includes("비근무") ? "비근무" : "현역",
  };
};

type AssistantFormModalProps = {
  visible: boolean;
  title: string;
  values: AssistantFormValues;
  saving: boolean;
  onChange: (key: keyof AssistantFormValues, value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

type FormInputProps = {
  label: string;
  value: string;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "phone-pad";
  onChange: (value: string) => void;
};

const FormInput = ({
  label,
  value,
  placeholder,
  keyboardType = "default",
  onChange,
}: FormInputProps) => (
  <View style={styles.fieldGroup}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChange}
      keyboardType={keyboardType}
      placeholder={placeholder}
      placeholderTextColor="#9CA3AF"
      autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
    />
  </View>
);

export default function AssistantFormModal({
  visible,
  title,
  values,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: AssistantFormModalProps) {
  const selectedRoles = new Set(splitValues(values.role));

  const handleClose = () => {
    if (!saving) onCancel();
  };

  const toggleRole = (role: string) => {
    const next = new Set(selectedRoles);
    if (next.has(role)) next.delete(role);
    else next.add(role);

    onChange("role", ROLE_OPTIONS.filter(option => next.has(option)).join(", "));
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <View style={styles.modalView}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={handleClose}
              disabled={saving}
              accessibilityLabel="닫기"
            >
              <Ionicons name="close" size={24} color="#374151" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
          >
            <FormInput
              label="이름 (필수)"
              value={values.name}
              placeholder="이름"
              onChange={value => onChange("name", value)}
            />
            <FormInput
              label="Gmail (필수)"
              value={values.email}
              placeholder="example@gmail.com"
              keyboardType="email-address"
              onChange={value => onChange("email", value)}
            />
            <FormInput
              label="전화번호"
              value={values.phone}
              placeholder="010-1234-5678"
              keyboardType="phone-pad"
              onChange={value => onChange("phone", value)}
            />

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>직책</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={values.position}
                  onValueChange={value => onChange("position", String(value))}
                  style={styles.picker}
                  dropdownIconColor="#4F46E5"
                  mode="dropdown"
                >
                  {POSITION_OPTIONS.map(option => (
                    <Picker.Item key={option} label={option} value={option} />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>역할</Text>
              <View style={styles.roleGrid}>
                {ROLE_OPTIONS.map(option => {
                  const selected = selectedRoles.has(option);
                  return (
                    <Pressable
                      key={option}
                      style={[styles.roleOption, selected && styles.roleOptionSelected]}
                      onPress={() => toggleRole(option)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                    >
                      <Ionicons
                        name={selected ? "checkbox" : "square-outline"}
                        size={20}
                        color={selected ? "#4F46E5" : "#9CA3AF"}
                      />
                      <Text style={[styles.roleText, selected && styles.roleTextSelected]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <FormInput
              label="근무 시작"
              value={values.startDate}
              placeholder="ex) 2024년 1학기"
              onChange={value => onChange("startDate", value)}
            />
            <FormInput
              label="계좌번호"
              value={values.account}
              placeholder="계좌번호"
              onChange={value => onChange("account", value)}
            />

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>비고</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={values.status}
                  onValueChange={value => onChange("status", String(value))}
                  style={styles.picker}
                  dropdownIconColor="#4F46E5"
                  mode="dropdown"
                >
                  {STATUS_OPTIONS.map(option => (
                    <Picker.Item key={option} label={option} value={option} />
                  ))}
                </Picker>
              </View>
            </View>
          </ScrollView>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              disabled={saving}
              style={[styles.button, styles.cancelButton, saving && styles.disabledButton]}
              onPress={handleClose}
            >
              <Text style={styles.cancelButtonText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={saving}
              style={[styles.button, styles.saveButton, saving && styles.disabledButton]}
              onPress={onSubmit}
            >
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveButtonText}>저장</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalView: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "88%",
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 20,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  title: { flex: 1, color: "#111827", fontSize: 19, fontWeight: "800" },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  formScroll: { width: "100%", flexShrink: 1 },
  formContent: { paddingBottom: 4 },
  fieldGroup: { marginBottom: 13 },
  label: { color: "#4B5563", fontSize: 12, fontWeight: "700", marginBottom: 6 },
  input: {
    width: "100%",
    height: 56,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: "#F9FAFB",
    color: "#111827",
    fontSize: 15,
  },
  pickerContainer: {
    height: 56,
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    backgroundColor: "#F9FAFB",
  },
  picker: { width: "100%", height: 56, color: "#111827", backgroundColor: "transparent" },
  roleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roleOption: {
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
  },
  roleOptionSelected: { borderColor: "#818CF8", backgroundColor: "#EEF2FF" },
  roleText: { color: "#4B5563", fontSize: 14, fontWeight: "700" },
  roleTextSelected: { color: "#3730A3" },
  buttonRow: { flexDirection: "row", gap: 10, width: "100%", marginTop: 16 },
  button: { flex: 1, minHeight: 46, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cancelButton: { backgroundColor: "#E5E7EB" },
  saveButton: { backgroundColor: "#4F46E5" },
  cancelButtonText: { color: "#374151", fontSize: 14, fontWeight: "700" },
  saveButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  disabledButton: { opacity: 0.6 },
});
