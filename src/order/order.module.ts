import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cart } from '../cart/entities/cart.entity';
import { OrderService } from './order.service';

@Module({
  imports: [TypeOrmModule.forFeature([Cart])],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule { }