import { Parser, GmailMessageData, Transaction } from '../types';
import { BHDParser } from './bhd';
import { QIKParser } from './qik';
import { CaribeParser } from './caribe';

export class ParserRegistry {
  private parsers: Parser[] = [];

  constructor() {
    this.register(new BHDParser());
    this.register(new QIKParser());
    this.register(new CaribeParser());
  }

  register(parser: Parser) {
    this.parsers.push(parser);
  }

  findParser(message: GmailMessageData): Parser | undefined {
    return this.parsers.find(p => p.canParse(message));
  }

  getAllParsers(): Parser[] {
    return this.parsers;
  }
}

export const parserRegistry = new ParserRegistry();
