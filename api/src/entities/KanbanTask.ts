import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('kanban_tasks')
@Index(['source', 'boardId', 'lane'])
@Index(['externalId'], { unique: true, where: 'externalId IS NOT NULL' })
export default class KanbanTask {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text', default: 'local' })
  source: 'local' | 'linear_symphony';

  @Column({ type: 'text', default: 'default' })
  boardId: string;

  @Column({ type: 'text', default: 'Default' })
  boardName: string;

  @Column({ type: 'text', default: 'triage' })
  lane: string;

  @Column({ type: 'text', default: 'P3' })
  priority: string;

  @Column({ type: 'text', default: '' })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'text', default: 'task' })
  tag: string;

  @Column({ type: 'text', nullable: true, default: null })
  assignee: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  agent: string | null;

  @Column({ type: 'text', default: 'core' })
  tenant: string;

  @Column({ type: 'integer', default: 0 })
  position: number;

  @Column({ type: 'text', nullable: true, default: null })
  externalId: string | null;

  @Column({ type: 'datetime', default: () => "datetime('now')" })
  createdAt: Date;

  @Column({ type: 'datetime', default: () => "datetime('now')" })
  updatedAt: Date;
}
