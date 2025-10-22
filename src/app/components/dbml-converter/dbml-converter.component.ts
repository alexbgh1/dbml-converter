import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { HeaderComponent } from '../header/header.component';
@Component({
  selector: 'app-dbml-converter',
  imports: [HeaderComponent, RouterOutlet],
  templateUrl: './dbml-converter.component.html',
})
export class DbmlConverterComponent {}
