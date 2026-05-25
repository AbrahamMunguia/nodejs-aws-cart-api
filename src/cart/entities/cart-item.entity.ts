import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  PrimaryColumn,
} from 'typeorm';
import { CartEntity } from './cart.entity';

@Entity('cart_items')
export class CartItemEntity {
  /**
   * Composite primary key: cart_id + product_id
   * Ensures each product appears at most once per cart.
   */
  @PrimaryColumn({ name: 'cart_id', type: 'uuid' })
  cart_id: string;

  @PrimaryColumn({ name: 'product_id', type: 'varchar', nullable: false })
  product_id: string;

  @Column({ type: 'integer', nullable: false, default: 1 })
  count: number;

  @ManyToOne(() => CartEntity, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id' })
  cart: CartEntity;
}
