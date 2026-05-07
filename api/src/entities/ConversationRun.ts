import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export type ConversationRunStatus = 'running' | 'completed' | 'error' | 'cancelled';

@Entity('conversation_runs')
@Index(['conversationId', 'status'])
export default class ConversationRun {
  @PrimaryGeneratedColumn()
  _id: number;

  @Column()
  conversationId: number;

  @Column({ type: 'text' })
  runId: string;

  @Column({ type: 'text', nullable: true, default: null })
  sessionId: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  upstreamRunId: string | null;

  @Column({ type: 'text', default: 'running' })
  status: ConversationRunStatus;

  @Column({ type: 'datetime', default: () => "datetime('now')" })
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true, default: null })
  completedAt: Date | null;

  @Column({ type: 'datetime', default: () => "datetime('now')" })
  lastEventAt: Date;

  @Column({ type: 'text', nullable: true, default: null })
  error: string | null;
}
