import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { BasicStrategy as Strategy } from 'passport-http';

@Injectable()
export class BasicStrategy extends PassportStrategy(Strategy, 'basic') {
  constructor() {
    super({ passReqToCallback: false });
  }

  async validate(username: string, password: string): Promise<{ id: string; name: string }> {
    const validUser = process.env.AUTH_USERNAME ?? 'AbrahamMunguia';
    const validPass = process.env.AUTH_PASSWORD ?? 'Test1237';

    if (username !== validUser || password !== validPass) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return { id: username, name: username };
  }
}