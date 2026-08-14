import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../../common/decorators/user.decorator';

export interface JwtPayload {
  sub: string;
  deviceId: string;
  phoneNumber: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'super_secret_jwt_access_key_12345'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub || !payload.deviceId) {
      throw new UnauthorizedException('Invalid token claims');
    }
    return {
      userId: payload.sub,
      deviceId: payload.deviceId,
      phoneNumber: payload.phoneNumber,
    };
  }
}
