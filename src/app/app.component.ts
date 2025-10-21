import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DbmlConverterComponent } from './components/dbml-converter/dbml-converter.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, DbmlConverterComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {
  title = 'dbdiagram-converter';
}
