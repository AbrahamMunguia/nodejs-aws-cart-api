import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { CartModule } from './cart/cart.module';
// Keep any existing modules from the original repo (auth, users, orders…)
// import { AuthModule }  from './auth/auth.module';
// import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Load environment variables first so DatabaseModule can read them
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    CartModule,
    // AuthModule,
    // UsersModule,
  ],
})
export class AppModule { }
