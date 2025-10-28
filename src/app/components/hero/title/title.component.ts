import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ArrowRightIconComponent } from '../../../shared/components/icons/arrows/arrow-right-icon.component';

@Component({
  selector: 'app-title',
  templateUrl: './title.component.html',
  imports: [RouterLink, ArrowRightIconComponent],
  host: {
    class: 'flex flex-col mt-6 text-left max-w-[600px] mx-4',
  },
})
export class TitleComponent {}
