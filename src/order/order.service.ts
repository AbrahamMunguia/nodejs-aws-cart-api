import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { Cart, CartStatus } from '../cart/entities/cart.entity';
import { CheckoutDto } from './dto/checkout.dto';

@Injectable()
export class OrderService {
    constructor(
        @Inject(getRepositoryToken(Cart))
        private readonly cartRepo: Repository<Cart>,

        @Inject(DataSource)
        private readonly dataSource: DataSource,
    ) { }

    async checkout(userId: string, dto: CheckoutDto): Promise<Order> {
        // 1. Find the user's open cart (with items)
        const cart = await this.cartRepo.findOne({
            where: { userId, status: CartStatus.OPEN },
        });

        if (!cart) {
            throw new NotFoundException('No open cart found for this user');
        }

        // Need items – run a raw query to avoid TypeORM metadata issues
        const items: Array<{ product_id: string; count: number }> =
            await this.dataSource.query(
                `SELECT product_id, count FROM cart_items WHERE cart_id = $1`,
                [cart.id],
            );

        if (!items.length) {
            throw new BadRequestException('Cannot checkout an empty cart');
        }

        // 2. Wrap cart update + order creation in a transaction
        const [order]: Order[] = await this.dataSource.transaction(async (manager) => {
            // Mark cart as ORDERED
            await manager.query(
                `UPDATE carts SET status = 'ORDERED', updated_at = now() WHERE id = $1`,
                [cart.id],
            );

            // Snapshot items and insert order via raw SQL — avoids entity metadata
            const orderItems = items.map((i) => ({ productId: i.product_id, count: i.count }));
            const delivery = { address: dto.address, firstName: dto.firstName, lastName: dto.lastName, comment: dto.comment ?? null };

            return manager.query(
                `INSERT INTO orders (user_id, cart_id, status, items, delivery)
         VALUES ($1, $2, 'OPEN', $3::jsonb, $4::jsonb)
         RETURNING *`,
                [userId, cart.id, JSON.stringify(orderItems), JSON.stringify(delivery)],
            );
        });

        return order;
    }

    async findByUserId(userId: string): Promise<Order[]> {
        return this.dataSource.query(
            `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
            [userId],
        );
    }

    async findById(id: string): Promise<Order> {
        const [order] = await this.dataSource.query(
            `SELECT * FROM orders WHERE id = $1`,
            [id],
        );
        if (!order) throw new NotFoundException(`Order ${id} not found`);
        return order;
    }
}