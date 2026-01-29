// [조교] 탭
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Linking, TouchableOpacity, RefreshControl, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Config & Utils
import { fetchSheetData } from "../../utils/googleSheet_csv";
import { CSV_URLS, ASSISTANT_HEADERS } from "../../config/sheetConfig";

type Assistant = {
  name: string;
  rawPosition: string;
  positions: string[];
  phone: string;
  email: string;
  roles: string[]; 
  status: string;
  startDate: string;
  isInactive: boolean;
};

export default function AssistantScreen() {
  const [allData, setAllData] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [activeCollapsed, setActiveCollapsed] = useState(false);
  const [inactiveCollapsed, setInactiveCollapsed] = useState(true); // 비근무는 기본 접힘(원하면 false로)
  const [showField, setShowField] = useState(true);       // 현장
  const [showMaterial, setShowMaterial] = useState(true); // 자료

  const loadData = useCallback(async () => {
    try {
      const data = await fetchSheetData(CSV_URLS.ASSISTANT_INFO);
      
      const cleanData = data.map((row: any) => {
        const rawPos = row[ASSISTANT_HEADERS.POSITION] || "";
        const rawRole = row[ASSISTANT_HEADERS.ROLE] || "";
        const status = row[ASSISTANT_HEADERS.STATUS] || "";
        
        return {
          name: row[ASSISTANT_HEADERS.NAME],
          rawPosition: rawPos,
          positions: rawPos.split(",").map((s: string) => s.trim()).filter(Boolean),
          phone: row[ASSISTANT_HEADERS.PHONE],
          email: row[ASSISTANT_HEADERS.EMAIL],
          roles: rawRole.split(",").map((s: string) => s.trim()).filter(Boolean),
          status: status,
          startDate: row[ASSISTANT_HEADERS.START_DATE] || "",
          isInactive: status.includes("비근무"),
        };
      });

      setAllData(cleanData);

    } catch (error) {
      console.error(error);
      Alert.alert("오류", "정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const { ceos, managers, activeAssistants, inactiveAssistants } = useMemo(() => {
    const groupCeo: Assistant[] = [];
    const groupManager: Assistant[] = [];
    const groupActive: Assistant[] = [];
    const groupInactive: Assistant[] = [];

    allData.forEach(staff => {
      // 1) CEO/실장/조교 그룹 분류
      if (staff.rawPosition.includes("CEO")) {
        groupCeo.push(staff);
        return;
      }
      if (staff.rawPosition.includes("실장")) {
        groupManager.push(staff);
        return;
      }

      // 2) 조교: 역할 필터(현장/자료)만 적용
      const hasField = staff.roles.includes("현장");
      const hasMaterial = staff.roles.includes("자료");

      if (staff.roles.length > 0) {
        const matchField = showField && hasField;
        const matchMaterial = showMaterial && hasMaterial;
        if (!matchField && !matchMaterial) return;
      }

      // 3) 상태에 따라 두 그룹으로 분리
      if (staff.isInactive) groupInactive.push(staff);
      else groupActive.push(staff);
    });

    return {
      ceos: groupCeo,
      managers: groupManager,
      activeAssistants: groupActive,
      inactiveAssistants: groupInactive,
    };
  }, [allData, showField, showMaterial]);


  const handleCall = (phone: string) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone.replace(/-/g, "")}`);
  };

  const handleSms = (phone: string) => {
    if (!phone) return;
    Linking.openURL(`sms:${phone.replace(/-/g, "")}`);
  };

  const getBadgeColor = (posName: string) => {
    if (posName.includes("CEO")) return "#111827";
    if (posName.includes("실장")) return "#10B981";
    if (posName.includes("조교장")) return "#EF4444";
    if (posName.includes("개발")) return "#8B5CF6";
    return "#3B82F6";
  };

  // 체크박스 컴포넌트
  const CheckBox = ({ label, value, onChange }: { label: string, value: boolean, onChange: (v: boolean) => void }) => (
    <TouchableOpacity style={styles.checkboxContainer} onPress={() => onChange(!value)} activeOpacity={0.7}>
      <Ionicons 
        name={value ? "checkbox" : "square-outline"} 
        size={20} 
        color={value ? "#4F46E5" : "#9CA3AF"} 
      />
      <Text style={[styles.checkboxLabel, value && styles.checkboxLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const StaffCard = ({ item }: { item: Assistant }) => (
    <View style={[styles.card, item.isInactive && styles.cardInactive]}>
      <View style={styles.cardHeader}>
        <View style={styles.headerTop}>
            <View style={styles.headerLeft}>
                <Text style={[styles.name, item.isInactive && styles.textInactive]}>{item.name}</Text>
                {/* 직책 뱃지 */}
                <View style={styles.badgeContainer}>
                  {item.positions.map((pos, idx) => (
                      <View key={idx} style={[styles.badge, { backgroundColor: getBadgeColor(pos) }, item.isInactive && styles.badgeInactive]}>
                      <Text style={styles.badgeText}>{pos}</Text>
                      </View>
                  ))}
                </View>
            </View>
            <Text style={[styles.startDate, item.isInactive && styles.textInactive]}>{item.startDate}</Text>
        </View>
        
        {/* 역할 뱃지 표시 (비근무여도 표시) */}
        {item.roles.length > 0 && (
          <View style={styles.roleContainer}>
            {item.roles.map((role, idx) => (
              <View
                key={idx}
                style={[
                  styles.roleBadge,
                  item.isInactive && styles.roleBadgeInactive,
                ]}
              >
                <Text
                  style={[
                    styles.roleText,
                    item.isInactive && styles.roleTextInactive,
                  ]}
                >
                  {role}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
      
      <View style={styles.divider} />

      <View style={styles.row}>
        <TouchableOpacity 
          style={styles.contactItem} 
          onPress={() => !item.isInactive && handleCall(item.phone)}
          disabled={item.isInactive}
        >
            <Ionicons name="call" size={16} color={item.isInactive ? "#9CA3AF" : "#6B7280"} />
            <Text style={[styles.contactText, item.isInactive && styles.textInactive]}>
              {item.phone || "-"}
            </Text>
        </TouchableOpacity>
        
        {!item.isInactive && item.phone && (
          <TouchableOpacity style={styles.iconBtn} onPress={() => handleSms(item.phone)}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#4B5563" />
          </TouchableOpacity>
        )}
      </View>

      {item.email ? (
        <View style={styles.row}>
            <View style={styles.contactItem}>
                <Ionicons name="mail" size={16} color={item.isInactive ? "#9CA3AF" : "#6B7280"} />
                <Text style={[styles.contactText, item.isInactive && styles.textInactive]}>
                  {item.email}
                </Text>
            </View>
        </View>
      ) : null}
    </View>
  );

  // 중요 인물 꾸미기
  const ExecCard = ({ item }: { item: Assistant }) => {
    const isCEO = item.rawPosition.includes("CEO");
    const title = isCEO ? "CEO" : "실장";
    const accent = isCEO ? "#111827" : "#10B981";
    const icon = isCEO ? "sparkles-outline" : "briefcase-outline";

    return (
      <View style={styles.execCard}>
        {/* 상단 리본 */}
        <View style={[styles.execRibbon, { backgroundColor: accent }]}>
          <Ionicons name={icon as any} size={14} color="#fff" />
          <Text style={styles.execRibbonText}>{title}</Text>
        </View>

        {/* 본문 */}
        <View style={styles.execBody}>
          <View style={styles.execTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.execName}>{item.name}</Text>

              {/* 직책 배지(기존 뱃지 재사용) */}
              <View style={styles.execBadgeRow}>
                {item.positions.map((pos, idx) => (
                  <View key={idx} style={[styles.execBadge, { borderColor: accent }]}>
                    <Text style={[styles.execBadgeText, { color: accent }]}>{pos}</Text>
                  </View>
                ))}
              </View>
            </View>

            {!!item.startDate && (
              <View style={styles.execDatePill}>
                <Ionicons name="calendar-outline" size={14} color="#6B7280" />
                <Text style={styles.execDateText}>{item.startDate}</Text>
              </View>
            )}
          </View>

          {/* 연락처 */}
          <View style={styles.execInfoRow}>
            <View style={styles.execInfoItem}>
              <Ionicons name="call-outline" size={16} color="#4B5563" />
              <Text style={styles.execInfoText}>{item.phone || "-"}</Text>
            </View>
            {item.email ? (
              <View style={styles.execInfoItem}>
                <Ionicons name="mail-outline" size={16} color="#4B5563" />
                <Text style={styles.execInfoText} numberOfLines={1}>
                  {item.email}
                </Text>
              </View>
            ) : null}
          </View>

          {/* CTA 버튼 */}
          <View style={styles.execCtaRow}>
            <TouchableOpacity
              style={[styles.execCtaBtn, { borderColor: accent }]}
              onPress={() => handleCall(item.phone)}
              disabled={!item.phone}
              activeOpacity={0.8}
            >
              <Ionicons name="call" size={16} color={accent} />
              <Text style={[styles.execCtaText, { color: accent }]}>전화</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.execCtaBtn, { backgroundColor: accent, borderColor: accent }]}
              onPress={() => handleSms(item.phone)}
              disabled={!item.phone}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubble-ellipses" size={16} color="#fff" />
              <Text style={[styles.execCtaText, { color: "#fff" }]}>문자</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };



  if (loading && !refreshing) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#4F46E5" /></View>;
  }

  return (
    <ScrollView 
      style={styles.container} 
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.pageHeader}>
        <Text style={styles.headerTitle}>주소록</Text>
        <Text style={styles.headerDesc}>팀원 연락처 및 역할 정보입니다.</Text>
      </View>

      {/* 1. CEO 섹션 */}
      {ceos.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CEO</Text>
            {ceos.map((item, i) => <ExecCard key={`ceo-${i}`} item={item} />)}
        </View>
      )}

      {/* 2. 실장 섹션 */}
      {managers.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>실장</Text>
            {managers.map((item, i) => <ExecCard key={`mgr-${i}`} item={item} />)}
        </View>
      )}

      {/* 3. 조교 섹션 */}
      {/* 3. 조교 섹션 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          조교 ({activeAssistants.length + inactiveAssistants.length}명)
        </Text>

        {/* 필터 컨트롤 영역 (역할만 유지) */}
        <View style={styles.filterBox}>
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>역할</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <CheckBox label="현장" value={showField} onChange={setShowField} />
              <CheckBox label="자료" value={showMaterial} onChange={setShowMaterial} />
            </View>
          </View>
        </View>

        {/* ✅ 현역 조교 섹션 (접기/펼치기) */}
        <TouchableOpacity
          style={styles.collapseHeader}
          onPress={() => setActiveCollapsed(v => !v)}
          activeOpacity={0.7}
        >
          <View style={styles.collapseHeaderLeft}>
            <Ionicons
              name={activeCollapsed ? "chevron-forward" : "chevron-down"}
              size={18}
              color="#374151"
            />
            <Text style={styles.collapseTitle}>현역 조교</Text>
            <Text style={styles.collapseCount}>({activeAssistants.length}명)</Text>
          </View>
        </TouchableOpacity>

        {!activeCollapsed && (
          activeAssistants.length === 0 ? (
            <Text style={styles.emptyText}>조건에 맞는 현역 조교가 없습니다.</Text>
          ) : (
            activeAssistants.map((item, i) => <StaffCard key={`active-${i}`} item={item} />)
          )
        )}

        {/* ✅ 비근무 조교 섹션 (접기/펼치기) */}
        <TouchableOpacity
          style={[styles.collapseHeader, { marginTop: 10 }]}
          onPress={() => setInactiveCollapsed(v => !v)}
          activeOpacity={0.7}
        >
          <View style={styles.collapseHeaderLeft}>
            <Ionicons
              name={inactiveCollapsed ? "chevron-forward" : "chevron-down"}
              size={18}
              color="#374151"
            />
            <Text style={styles.collapseTitle}>비근무 조교</Text>
            <Text style={styles.collapseCount}>({inactiveAssistants.length}명)</Text>
          </View>
        </TouchableOpacity>

        {!inactiveCollapsed && (
          inactiveAssistants.length === 0 ? (
            <Text style={styles.emptyText}>조건에 맞는 비근무 조교가 없습니다.</Text>
          ) : (
            inactiveAssistants.map((item, i) => <StaffCard key={`inactive-${i}`} item={item} />)
          )
        )}
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  contentContainer: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  
  pageHeader: { padding: 20, paddingTop: 60, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", marginBottom: 10 },
  headerTitle: { fontSize: 24, fontWeight: "800", color: "#111" },
  headerDesc: { fontSize: 14, color: "#6B7280", marginTop: 4 },

  // 필터 스타일
  filterBox: { backgroundColor: "#fff", padding: 15, borderRadius: 12,marginBottom: 16,borderWidth: 1,borderColor: "#E5E7EB"},
  filterRow: { flexDirection: 'row', alignItems: 'center' },
  filterLabel: { fontSize: 14, fontWeight: "700", color: "#374151", width: 50 },
  filterDivider: { height: 1, backgroundColor: "#F3F4F6", marginVertical: 10 },
  
  checkboxContainer: { flexDirection: 'row', alignItems: 'center' },
  checkboxLabel: { marginLeft: 4, fontSize: 14, color: "#6B7280" },
  checkboxLabelActive: { color: "#1F2937", fontWeight: "600" },

  section: { marginTop: 20, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#374151", marginBottom: 12, marginLeft: 4 },

  card: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  // 비근무자 카드 스타일 (회색 배경)
  cardInactive: { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB", shadowOpacity: 0 },
  textInactive: { color: "#9CA3AF" },
  badgeInactive: { backgroundColor: "#9CA3AF", opacity: 0.7 },

  cardHeader: { marginBottom: 12 },
  headerTop: { flexDirection: "row", justifyContent: 'space-between', alignItems: "flex-start", marginBottom: 6 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flex: 1 },
  
  name: { fontSize: 17, fontWeight: "700", color: "#1F2937", marginRight: 8 },
  startDate: { fontSize: 13, color: "#6B7280", fontWeight: "500" },
  
  badgeContainer: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  // 역할 뱃지 스타일
  roleContainer: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  roleBadge: { backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: "#E5E7EB" },
  roleText: { fontSize: 12, color: "#4B5563", fontWeight: "600" },

  divider: { height: 1, backgroundColor: "#F3F4F6", marginBottom: 12 },

  row: { flexDirection: "row", alignItems: "center", marginBottom: 8, justifyContent: 'space-between' },
  contactItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  contactText: { fontSize: 14, color: "#4B5563", fontWeight: "500" },
  
  iconBtn: { padding: 4 },
  emptyText: { textAlign: "center", marginTop: 20, color: "#9CA3AF", fontSize: 14 },

  // 접이식 화면 구성
  collapseHeader: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 10,
  },
  collapseHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  collapseTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#374151",
  },
  collapseCount: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "600",
    marginLeft: 2,
  },

  // 중요 인물 이쁘게 꾸미기
  execCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  execRibbon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  execRibbonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  execBody: {
    padding: 16,
  },
  execTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  execName: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
  },
  execBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  execBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: "#F9FAFB",
  },
  execBadgeText: {
    fontSize: 12,
    fontWeight: "800",
  },
  execDatePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
  },
  execDateText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6B7280",
  },
  execInfoRow: {
    marginTop: 14,
    gap: 8,
  },
  execInfoItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  execInfoText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    flexShrink: 1,
  },
  execCtaRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  execCtaBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "#fff",
  },
  execCtaText: {
    fontSize: 14,
    fontWeight: "800",
  },

  // 비근무 조교 역할 태그 스타일
  roleBadgeInactive: {
    backgroundColor: "#E5E7EB",
    borderColor: "#D1D5DB",
  },
  roleTextInactive: {
    color: "#9CA3AF",
  },

});