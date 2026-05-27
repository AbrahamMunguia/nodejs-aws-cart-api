import {
    Entity, PrimaryGeneratedColumn, Column,
    CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export enum OrderStatus {
    OPEN = 'OPEN',
    CONFIRMED = 'CONFIRMED',
    SENT = 'SENT',
    COMPLETED = 'COMPLETED',
}

export interface OrderAddress {
    address: string;
    firstName: string;
    lastName: string;
    comment?: string;
}

export interface OrderItem {
    productId: string;
    count: number;
    price?: number;
}

@Entity('orders')
export class Order {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', type: 'varchar', nullable: false })
    userId: string;

    @Column({ name: 'cart_id', type: 'uuid', nullable: false })
    cartId: string;

    @Column({
        type: 'enum',
        enum: OrderStatus,
        default: OrderStatus.OPEN,
    })
    status: OrderStatus;

    /** Snapshot of cart items at the moment of checkout */
    @Column({ type: 'jsonb', nullable: false })
    items: OrderItem[];

    /** Delivery address captured at checkout */
    @Column({ type: 'jsonb', nullable: true })
    delivery: OrderAddress | null;

    @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
    total: number | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}