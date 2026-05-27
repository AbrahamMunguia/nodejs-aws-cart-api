import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  PrimaryColumn,
} from 'typeorm';
import { Cart } from './cart.entity';

@Entity('cart_items')
export class CartItem {
  /** Composite PK: cart_id + product_id uniquely identify a line item */
  @PrimaryColumn({ name: 'cart_id' })
  cartId: string;

  @PrimaryColumn({ name: 'product_id' })
  productId: string;

  @Column({ type: 'integer', default: 1 })
  count: number;

  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id' })
  cart: Cart;
}
