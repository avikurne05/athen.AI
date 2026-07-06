import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { ProposedDraft } from '../services/scheduler';
import { formatTime12Hour } from '../services/time';

interface ApprovalCardProps {
  drafts: ProposedDraft[];
  isOverbooked: boolean;
  warningMessage?: string;
  onApprove: () => void;
  onModify: () => void;
}

export default function ApprovalCard({
  drafts,
  isOverbooked,
  warningMessage,
  onApprove,
  onModify
}: ApprovalCardProps) {
  if (drafts.length === 0) return null;

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return formatTime12Hour(date);
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Proposed Schedule Changes</Text>
        <Text style={styles.headerSubtitle}>Safety Pipeline Draft</Text>
      </View>

      {warningMessage && (
        <View style={[styles.warningBanner, isOverbooked ? styles.overbookedBanner : null]}>
          <Text style={styles.warningText}>⚠️ {warningMessage}</Text>
        </View>
      )}

      <ScrollView style={[styles.scrollList, { maxHeight: 220 }]} nestedScrollEnabled={true}>
        {[...drafts]
          .sort((a, b) => {
            const timeA = a.proposed_start || a.original_start;
            const timeB = b.proposed_start || b.original_start;
            if (!timeA && !timeB) return 0;
            if (!timeA) return 1;
            if (!timeB) return -1;
            return new Date(timeA).getTime() - new Date(timeB).getTime();
          })
          .map((draft) => {
            let emoji = '🟢';
          let actionLabel = 'Add';
          let typeColor = '#4CAF50'; // Green

          if (draft.type === 'SHIFT') {
            emoji = '🕒';
            actionLabel = 'Shift';
            typeColor = '#FF9800'; // Amber
          } else if (draft.type === 'DELETE') {
            emoji = '🔴';
            actionLabel = 'Delete';
            typeColor = '#F44336'; // Red
          } else if (draft.type === 'COMPLETE') {
            emoji = '✅';
            actionLabel = 'Done';
            typeColor = '#4CAF50'; // Green
          } else if (draft.type === 'CARRY_FORWARD') {
            emoji = '🟣';
            actionLabel = 'Delay';
            typeColor = '#9C27B0'; // Purple
          }

          return (
            <View key={draft.id} style={styles.draftItem}>
              <View style={styles.draftLeft}>
                <View style={styles.draftLabelRow}>
                  <Text style={[styles.actionTag, { color: typeColor }]}>
                    {emoji} {actionLabel}
                  </Text>
                  <Text style={styles.taskTitle} numberOfLines={1}>
                    {draft.task_title}
                    {draft.category ? <Text style={styles.categoryText}>  • {draft.category}</Text> : null}
                  </Text>
                </View>
                {draft.message && (
                  <Text style={styles.infoMessage}>💡 {draft.message}</Text>
                )}
              </View>

              <View style={styles.draftRight}>
                {draft.type === 'SHIFT' && draft.proposed_start && (
                  <Text style={styles.timeText}>{formatTime(draft.proposed_start)}</Text>
                )}
                {draft.type === 'CREATE' && draft.proposed_start && (
                  <Text style={styles.timeText}>{formatTime(draft.proposed_start)}</Text>
                )}
                {draft.type === 'CARRY_FORWARD' && draft.proposed_start && (
                  <Text style={styles.timeText}>{formatDate(draft.proposed_start)}</Text>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.buttonsContainer}>
        <TouchableOpacity style={[styles.button, styles.modifyButton]} onPress={onModify}>
          <Text style={styles.modifyButtonText}>✏️ Modify</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.approveButton]} onPress={onApprove}>
          <Text style={styles.approveButtonText}>✓ Approve</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#FFE3E6',
    shadowColor: '#FF8DA1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    width: '100%'
  },
  header: {
    marginBottom: 8
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4A354F'
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#B3556A',
    marginTop: 1
  },
  warningBanner: {
    backgroundColor: '#FFF5EE', // Peach background
    borderColor: '#FFE3E6',
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    marginBottom: 8
  },
  overbookedBanner: {
    backgroundColor: '#FFE3E6',
    borderColor: '#FFC0CB'
  },
  warningText: {
    fontSize: 11,
    color: '#D44A70',
    lineHeight: 15
  },
  scrollList: {
    marginVertical: 4
  },
  draftItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#FFF0F2',
    gap: 8
  },
  draftLeft: {
    flex: 1,
    gap: 2
  },
  draftLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  actionTag: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    width: 65 // fixed width to align task titles vertically
  },
  taskTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4A354F',
    flex: 1
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8A5CF5',
    textTransform: 'uppercase'
  },
  infoMessage: {
    fontSize: 10,
    fontStyle: 'italic',
    color: '#B3556A',
    paddingLeft: 6
  },
  draftRight: {
    alignItems: 'flex-end',
    justifyContent: 'center'
  },
  timeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FF5C7A'
  },
  buttonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row'
  },
  modifyButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FFE3E6'
  },
  modifyButtonText: {
    color: '#FF5C7A',
    fontSize: 13,
    fontWeight: '600'
  },
  approveButton: {
    backgroundColor: '#FF8DA1'
  },
  approveButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600'
  }
});
