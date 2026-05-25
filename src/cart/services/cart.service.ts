import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CartEntity, CartStatus } from '../entities/cart.entity';
import { CartItemEntity } from '../entities/cart-item.entity';
import { Cart, CartItem, CartStatuses } from '../models';
import { PutCartPayload } from 'src/order/type';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartEntity)
    private readonly cartRepo: Repository<CartEntity>,
    @InjectRepository(CartItemEntity)
    private readonly cartItemRepo: Repository<CartItemEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private mapToCartModel(entity: CartEntity): Cart {
    return {
      id: entity.id,
      user_id: entity.user_id,
      created_at: entity.created_at ? entity.created_at.getTime() : Date.now(),
      updated_at: entity.updated_at ? entity.updated_at.getTime() : Date.now(),
      status: entity.status === CartStatus.OPEN ? CartStatuses.OPEN : CartStatuses.STATUS,
      items: (entity.items || []).map((item) => ({
        product: {
          id: item.product_id,
          title: `Product ${item.product_id}`,
          description: `Description of Product ${item.product_id}`,
          price: 100, // Mock price since product details are not stored in DB
        },
        count: item.count,
      })),
    };
  }

  private async findOrCreateByUserIdEntity(userId: string): Promise<CartEntity> {
    let cart = await this.cartRepo.findOne({
      where: { user_id: userId, status: CartStatus.OPEN },
      relations: { items: true },
    });

    if (!cart) {
      cart = this.cartRepo.create({ user_id: userId, status: CartStatus.OPEN });
      cart = await this.cartRepo.save(cart);
      cart.items = [];
    }

    return cart;
  }

  // ─── Cart CRUD ───────────────────────────────────────────────────────────────

  async findOrCreateByUserId(userId: string): Promise<Cart> {
    const entity = await this.findOrCreateByUserIdEntity(userId);
    return this.mapToCartModel(entity);
  }

  async findByUserId(userId: string): Promise<Cart | null> {
    const entity = await this.cartRepo.findOne({
      where: { user_id: userId, status: CartStatus.OPEN },
      relations: { items: true },
    });
    return entity ? this.mapToCartModel(entity) : null;
  }

  async findById(cartId: string): Promise<Cart | null> {
    const entity = await this.cartRepo.findOne({
      where: { id: cartId },
      relations: { items: true },
    });
    return entity ? this.mapToCartModel(entity) : null;
  }

  async updateByUserId(userId: string, payload: PutCartPayload): Promise<Cart> {
    const cartEntity = await this.findOrCreateByUserIdEntity(userId);
    const productId = payload.product.id;
    const count = payload.count;

    if (count <= 0) {
      await this.cartItemRepo.delete({ cart_id: cartEntity.id, product_id: productId });
    } else {
      const existing = await this.cartItemRepo.findOne({
        where: { cart_id: cartEntity.id, product_id: productId },
      });
      if (existing) {
        existing.count = count;
        await this.cartItemRepo.save(existing);
      } else {
        const newItem = this.cartItemRepo.create({
          cart_id: cartEntity.id,
          product_id: productId,
          count,
        });
        await this.cartItemRepo.save(newItem);
      }
    }

    const updatedEntity = await this.cartRepo.findOneOrFail({
      where: { id: cartEntity.id },
      relations: { items: true },
    });

    return this.mapToCartModel(updatedEntity);
  }

  async updateCart(
    userId: string,
    items: { productId: string; count: number }[],
  ): Promise<Cart> {
    return this.dataSource.transaction(async (manager) => {
      let cart = await manager.findOne(CartEntity, {
        where: { user_id: userId, status: CartStatus.OPEN },
        relations: { items: true },
      });

      if (!cart) {
        cart = manager.create(CartEntity, {
          user_id: userId,
          status: CartStatus.OPEN,
        });
        cart = await manager.save(CartEntity, cart);
      }

      // Remove existing items and replace with new list
      await manager.delete(CartItemEntity, { cart_id: cart.id });

      const newItems = items
        .filter((i) => i.count > 0)
        .map((i) =>
          manager.create(CartItemEntity, {
            cart_id: cart!.id,
            product_id: i.productId,
            count: i.count,
          }),
        );

      await manager.save(CartItemEntity, newItems);

      const updatedEntity = await manager.findOneOrFail(CartEntity, {
        where: { id: cart.id },
        relations: { items: true },
      });

      return this.mapToCartModel(updatedEntity);
    });
  }

  async checkout(userId: string): Promise<Cart> {
    const cart = await this.cartRepo.findOne({
      where: { user_id: userId, status: CartStatus.OPEN },
    });

    if (!cart) {
      throw new NotFoundException(`No open cart found for user ${userId}`);
    }

    cart.status = CartStatus.ORDERED;
    const updatedEntity = await this.cartRepo.save(cart);
    return this.mapToCartModel(updatedEntity);
  }

  async removeByUserId(userId: string): Promise<void> {
    await this.cartRepo.delete({ user_id: userId, status: CartStatus.OPEN });
  }

  // ─── Cart Item ops ───────────────────────────────────────────────────────────

  async addItem(
    userId: string,
    productId: string,
    count: number,
  ): Promise<Cart> {
    const cart = await this.findOrCreateByUserIdEntity(userId);

    const existing = cart.items.find((i) => i.product_id === productId);
    if (existing) {
      existing.count += count;
      await this.cartItemRepo.save(existing);
    } else {
      const item = this.cartItemRepo.create({
        cart_id: cart.id,
        product_id: productId,
        count,
      });
      await this.cartItemRepo.save(item);
    }

    const updatedEntity = await this.findOrCreateByUserIdEntity(userId);
    return this.mapToCartModel(updatedEntity);
  }

  async removeItem(userId: string, productId: string): Promise<Cart> {
    const cart = await this.findOrCreateByUserIdEntity(userId);
    await this.cartItemRepo.delete({ cart_id: cart.id, product_id: productId });
    const updatedEntity = await this.findOrCreateByUserIdEntity(userId);
    return this.mapToCartModel(updatedEntity);
  }
}
