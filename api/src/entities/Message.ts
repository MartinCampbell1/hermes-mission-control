import { Entity, PrimaryGeneratedColumn, Column, DeleteDateColumn, Index } from 'typeorm';

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';
export type MessageKind = 'message' | 'reasoning' | 'tool_call' | 'tool_result' | 'status';
export type ToolStatus = 'running' | 'done' | 'error' | null;

@Entity('messages')
@Index(['conversationId', 'externalId'], { unique: true, where: 'externalId IS NOT NULL' })
export default class Message {
  @PrimaryGeneratedColumn()
  _id: number;

  @Column()
  conversationId: number;

  @Column({ type: 'text', nullable: true, default: null })
  externalId: string | null;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'text', nullable: true, default: null })
  thinking: string | null;

  @Column({ type: 'simple-json', default: '[]' })
  files: { filename: string; originalName: string; mimetype: string; size: number; url: string }[];

  @Column({ type: 'text', default: 'user' })
  role: MessageRole;

  @Column({ type: 'text', default: 'message' })
  kind: MessageKind;

  @Column({ type: 'text', nullable: true, default: null })
  sourceSessionId: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  toolName: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  toolCallId: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  toolStatus: ToolStatus;

  @Column({ type: 'text', nullable: true, default: null })
  finishReason: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  runId: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  upstreamRunId: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  clientTurnId: string | null;

  @Column({ type: 'boolean', default: false })
  provisional: boolean;

  @Column({ type: 'simple-json', default: '{}' })
  metadata: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  hidden: boolean;

  @Column()
  createdBy: number;

  @Column({ type: 'datetime', default: () => "datetime('now')" })
  createdAt: Date;

  @DeleteDateColumn({ type: 'datetime', nullable: true, default: null })
  deletedAt: Date | null;
}
