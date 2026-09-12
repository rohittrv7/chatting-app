import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExpenseService } from './expense.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/user.decorator';
import { CreateExpenseSplitDto, SettleUpDto } from './dto/create-expense.dto';
import { IsString, IsOptional } from 'class-validator';

export class MarkPaidDto {
  @IsString()
  @IsOptional()
  targetUserId?: string;
}

@ApiTags('Expenses')
@Controller('expenses')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Post('split')
  @ApiOperation({ summary: 'Create a new expense split (1:1 chat or lightweight split group)' })
  async createExpenseSplit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseSplitDto,
  ) {
    return this.expenseService.createExpenseSplit(user.userId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new expense split (alias)' })
  async createExpense(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpenseSplitDto) {
    return this.expenseService.createExpenseSplit(user.userId, dto);
  }

  @Get('net-balances')
  @ApiOperation({
    summary: 'Get overall pairwise net balances (Simplify Debts / per-contact balances)',
  })
  async getNetBalances(@CurrentUser() user: AuthenticatedUser) {
    return this.expenseService.getNetBalances(user.userId);
  }

  @Post('settle-up')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a bilateral direct settlement with a contact' })
  async settleUp(@CurrentUser() user: AuthenticatedUser, @Body() dto: SettleUpDto) {
    return this.expenseService.settleUpDirect(user.userId, dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get hisaab history and summary (owed by me, owed to me)' })
  async getExpenseHistoryAlias(
    @CurrentUser() user: AuthenticatedUser,
    @Query('category') category?: string,
  ) {
    return this.expenseService.getExpenseHistory(user.userId, category);
  }

  @Get()
  @ApiOperation({ summary: 'Get hisaab history and summary (alias)' })
  async getExpenseHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query('category') category?: string,
  ) {
    return this.expenseService.getExpenseHistory(user.userId, category);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of an expense split' })
  async getExpenseById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.expenseService.getExpenseById(user.userId, id);
  }

  @Patch(':id/participants/:userId/paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark participant share as paid (RESTful PATCH endpoint)' })
  async markParticipantPaidPatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.expenseService.markParticipantPaid(user.userId, id, targetUserId);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark participant share as paid (POST alias)' })
  async markPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: MarkPaidDto,
  ) {
    const targetUserId = body?.targetUserId || user.userId;
    return this.expenseService.markParticipantPaid(user.userId, id, targetUserId);
  }

  @Post(':id/remind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send payment reminder to unpaid participants' })
  async remindUnpaid(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.expenseService.remindUnpaidParticipants(user.userId, id);
  }

  @Post(':id/force-cleanup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger immediate auto-delete of settled group (testing/dev)' })
  async forceCleanup(@Param('id') id: string) {
    return this.expenseService.executeAutoDelete(id);
  }
}
