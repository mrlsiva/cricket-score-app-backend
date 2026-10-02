import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID token obtained on Android via Credential Manager / Google Sign-In' })
  @IsString()
  @MinLength(20)
  idToken!: string;
}

export class DevLoginDto {
  @ApiProperty({ example: 'organizer@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Test Organizer' })
  @IsString()
  @MaxLength(120)
  name!: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

export class OnboardingDto {
  @ApiProperty({ enum: ['ORGANIZER', 'INDIVIDUAL'], isArray: true, example: ['INDIVIDUAL'], description: 'One account may hold both types' })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(['ORGANIZER', 'INDIVIDUAL'], { each: true })
  accountTypes!: ('ORGANIZER' | 'INDIVIDUAL')[];

  @ApiPropertyOptional({ example: 'Chennai' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'mobile must be a valid phone number' })
  mobile?: string;
}

export class AuthResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ example: 900 }) expiresIn!: number;
  @ApiProperty({ description: 'True when the user must call POST /auth/onboarding to choose account type' })
  requiresOnboarding!: boolean;
  @ApiProperty() user!: Record<string, unknown>;
}
