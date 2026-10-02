import { Controller, Get, Param, ParseUUIDPipe, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ExportsService } from './exports.service';

const send = (res: Response, file: { buffer: Buffer; filename: string }, type: string) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('X-Developed-By', 'Sling Groups');
  return new StreamableFile(file.buffer);
};

@ApiTags('Scorecard Export')
@ApiBearerAuth()
@Controller('matches/:matchId/export')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('scorecard.pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Full scorecard PDF (footer: Developed by Sling Groups)' })
  async scorecardPdf(@Param('matchId', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.exports.scorecardPdf(id), 'application/pdf');
  }

  @Get('summary.pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'One-page match summary PDF' })
  async summaryPdf(@Param('matchId', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.exports.summaryPdf(id), 'application/pdf');
  }

  @Get('scorecard.png')
  @ApiProduces('image/png')
  @ApiOperation({ summary: 'Scorecard image (PNG)' })
  async scorecardPng(@Param('matchId', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.exports.scorecardPng(id), 'image/png');
  }

  @Get('share.png')
  @ApiProduces('image/png')
  @ApiOperation({ summary: 'WhatsApp share image (1080×1080 PNG)' })
  async sharePng(@Param('matchId', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    return send(res, await this.exports.sharePng(id), 'image/png');
  }
}
