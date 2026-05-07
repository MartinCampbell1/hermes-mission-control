import { Entity, PrimaryGeneratedColumn, Column, DeleteDateColumn, Index } from 'typeorm';

@Entity('conversations')
@Index(['agentId', 'sessionKey'], { unique: true, where: 'sessionKey IS NOT NULL' })
@Index(['agentId', 'threadKey'])
export default class Conversation {
  @PrimaryGeneratedColumn()
  _id: number;

  @Column()
  agentId: number;

  @Column({ type: 'text', nullable: true, default: null })
  title: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  sessionKey: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  threadKey: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  rootSessionKey: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  messageSource: 'state_db' | 'json_fallback' | null;

  @Column({ type: 'text', nullable: true, default: null })
  thinkingLevel: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  reasoningLevel: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  verboseLevel: string | null;

  @Column({ type: 'boolean', nullable: true, default: null })
  fastMode: boolean | null;

  @Column({ type: 'text', nullable: true, default: null })
  modelOverride: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  providerOverride: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  skillsOverride: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  toolsetsOverride: string | null;

  @Column()
  createdBy: number;

  @Column({ type: 'datetime', default: () => "datetime('now')" })
  createdAt: Date;

  @DeleteDateColumn({ type: 'datetime', nullable: true, default: null })
  deletedAt: Date | null;
}
