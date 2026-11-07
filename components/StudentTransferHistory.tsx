import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StudentTransfer } from '../lib/classData';

export function StudentTransferHistory({ classId, name, history = [] }: { classId: string; name: string; history?: StudentTransfer[] }) {
  const [visible, setVisible] = useState(false);
  if (!history.length) return null;
  const incoming = history.filter((item) => item.targetClassId === classId).slice(-1)[0];
  return <View style={styles.container}>
    {incoming && <Text style={styles.incoming}>전반 ← {incoming.sourceClassName} ({incoming.effectiveOn})</Text>}
    <Pressable onPress={() => setVisible(true)} style={styles.button}><Text style={styles.link}>전반 이력 {history.length}건 보기</Text></Pressable>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.overlay}><View style={styles.modal}>
        <View style={styles.header}><Text style={styles.title}>{name} · 전반 이력</Text><Pressable onPress={() => setVisible(false)}><Text style={styles.link}>닫기</Text></Pressable></View>
        <ScrollView>{history.map((item) => <View key={item.id} style={styles.item}>
          <Text style={styles.date}>{item.termLabel} · {item.effectiveOn}</Text>
          <Text style={styles.route}>{item.sourceClassName} → {item.targetClassName}</Text>
        </View>)}</ScrollView>
      </View></View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  container: { marginTop: 5, gap: 4 }, incoming: { color: '#B91C1C', fontSize: 11, lineHeight: 16 }, button: { alignSelf: 'flex-start', paddingVertical: 5 }, link: { color: '#4F46E5', fontSize: 12, fontWeight: '700' },
  overlay: { flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.55)' }, modal: { width: '100%', maxWidth: 650, maxHeight: '80%', padding: 20, backgroundColor: '#FFFFFF', borderRadius: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }, title: { color: '#111827', fontWeight: '800', fontSize: 17 },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }, date: { color: '#64748B', fontSize: 12 }, route: { color: '#111827', fontSize: 14, marginTop: 5, lineHeight: 22 },
});
