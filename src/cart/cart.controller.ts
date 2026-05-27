import {
  Controller, Get, Put, Delete, Post,
  Body, Req, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { UpdateCartDto } from './dto/update-cart.dto';

// Re-use the auth guard that already exists in the repo
// (import path matches the original project layout)
import { BasicAuthGuard } from '../auth/guards/bacis-auth.guard';

@Controller('profile/cart')
@UseGuards(BasicAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) { }

  @Get()
  async getCart(@Req() req: any) {
    const cart = await this.cartService.findOrCreateByUserId(req.user?.id);
    return { statusCode: HttpStatus.OK, message: 'OK', data: { cart } };
  }

  @Put()
  async updateCart(@Req() req: any, @Body() dto: UpdateCartDto) {
    const cart = await this.cartService.updateCart(req.user?.id, dto);
    return { statusCode: HttpStatus.OK, message: 'OK', data: { cart } };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCart(@Req() req: any) {
    await this.cartService.removeByUserId(req.user?.id);
  }

  @Post('checkout')
  async checkout(@Req() req: any) {
    const cart = await this.cartService.checkout(req.user?.id);
    return { statusCode: HttpStatus.OK, message: 'OK', data: { cart } };
  }
}
