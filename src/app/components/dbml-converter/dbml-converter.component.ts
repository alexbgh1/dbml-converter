import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';
@Component({
  selector: 'app-dbml-converter',
  imports: [HeaderComponent, RouterOutlet, FooterComponent],
  templateUrl: './dbml-converter.component.html',
  host: { class: 'flex flex-col min-h-screen' },
})
export class DbmlConverterComponent {}
