import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { BasicStrategy } from './strategies/basic.strategy';
import { BasicAuthGuard } from './guards/bacis-auth.guard';
import { JwtStrategy } from './strategies';
import { LocalStrategy } from './strategies';

@Module({
  imports: [PassportModule],
  providers: [BasicStrategy, BasicAuthGuard, JwtStrategy, LocalStrategy, BasicStrategy],
  exports: [BasicAuthGuard],
})
export class AuthModule { }