import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart, CartStatus } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { UpdateCartDto } from './dto/update-cart.dto';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepo: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly itemRepo: Repository<CartItem>,
  ) {}

  async findOrCreateByUserId(userId: string): Promise<Cart> {
    let cart = await this.cartRepo.findOne({
      where: { userId, status: CartStatus.OPEN },
      relations: ['items'],
    });
    if (!cart) {
      cart = this.cartRepo.create({ userId, status: CartStatus.OPEN, items: [] });
      await this.cartRepo.save(cart);
    }
    return cart;
  }

  async updateCart(userId: string, dto: UpdateCartDto): Promise<Cart> {
    const cart = await this.findOrCreateByUserId(userId);
    const existing = cart.items.find((i) => i.productId === dto.productId);

    if (existing) {
      if (dto.count === 0) {
        await this.itemRepo.delete({ cartId: cart.id, productId: dto.productId });
      } else {
        existing.count = dto.count;
        await this.itemRepo.save(existing);
      }
    } else if (dto.count > 0) {
      const item = this.itemRepo.create({ cartId: cart.id, productId: dto.productId, count: dto.count });
      await this.itemRepo.save(item);
    }

    return this.findOrCreateByUserId(userId);
  }

  async checkout(userId: string): Promise<Cart> {
    const cart = await this.findOrCreateByUserId(userId);
    if (!cart) throw new NotFoundException('No open cart found');
    cart.status = CartStatus.ORDERED;
    return this.cartRepo.save(cart);
  }

  async removeByUserId(userId: string): Promise<void> {
    const cart = await this.cartRepo.findOne({ where: { userId, status: CartStatus.OPEN } });
    if (cart) await this.cartRepo.remove(cart);
  }
}
